import { describe, expect, it } from "vitest";
import { unrealClubs } from "../unrealClubs";
import { forgetClubs, isDeletedClub, restoreClubs } from "../deletedGames";
import { createGcImporter, type GcImportState } from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

const TODAY = "2026-09-20";

/**
 * Deleting the rows is not enough while the club that files them is still in the pull list: the
 * next run reads the same schedule and files a fresh set. The club is the thing to delete.
 */
const group: AgeGroup = { id: "ag11", name: "11U 2027", seasonIds: [], ageLevel: 11, year: 2027 };

const team = (id: string, name: string, gcId?: string): ScoutTeam => ({
  id,
  name,
  city: "Orlando",
  state: "FL",
  ...(gcId ? { gcTeams: [{ teamId: gcId, name, ageGroupId: group.id, ageLevel: 11 }] } : {}),
});

const game = (
  id: string,
  a: string,
  b: string,
  date: string,
  scored = true,
  filedBy?: string
): ScoutGame => ({
  id,
  teamAId: a,
  teamBId: b,
  ageGroupId: group.id,
  date,
  ...(scored ? { teamAScore: 11, teamBScore: 0 } : {}),
  ...(filedBy ? { source: { kind: "gamechanger" as const, teamId: filedBy, gameId: id } } : {}),
});

const pool: GcImportState = {
  ageGroups: [group],
  teams: [
    team("S-FAKE", "Test team", "WpYo8bR3Smwp"),
    team("S-REAL", "Orlando Scrappers", "lvvjCaqPngbP"),
    team("S-ODD", "Mostly Fine", "aaaaaaaaaaaa"),
  ],
  games: [
    // Every one of this club's games is impossible.
    game("g1", "S-FAKE", "S-REAL", "2027-07-31"),
    game("g2", "S-FAKE", "S-REAL", "2027-07-30"),
    // A scheduled game with no score is ordinary, whatever its date.
    game("g3", "S-FAKE", "S-REAL", "2027-08-01", false),
    // One wrong date on a club that is otherwise fine.
    game("g4", "S-ODD", "S-REAL", "2027-01-05"),
    game("g5", "S-ODD", "S-REAL", "2026-08-20"),
    game("g6", "S-ODD", "S-REAL", "2026-08-21"),
  ],
};

/**
 * An inventor lists a real club as its opponent week after week. Charged to both sides, the real
 * club carried every one of those rows and came out at the top of the list, above the inventor;
 * charged to the schedule that filed them, the inventor leads and the real club is not listed.
 */
describe("the club that filed them, not the club they were filed against", () => {
  const filed: GcImportState = {
    ...pool,
    games: [
      game("f1", "S-FAKE", "S-REAL", "2027-07-31", true, "WpYo8bR3Smwp"),
      game("f2", "S-FAKE", "S-REAL", "2027-07-30", true, "WpYo8bR3Smwp"),
      game("f3", "S-FAKE", "S-ODD", "2027-07-29", true, "WpYo8bR3Smwp"),
      // One the real club filed itself: it is charged with that one and nothing else.
      game("f4", "S-REAL", "S-ODD", "2027-06-01", true, "lvvjCaqPngbP"),
      game("f5", "S-REAL", "S-ODD", "2026-08-21", true, "lvvjCaqPngbP"),
    ],
  };

  it("puts the club whose schedule wrote the most of them at the top", () => {
    expect(unrealClubs(filed, TODAY).map((club) => [club.name, club.ahead, club.played])).toEqual([
      ["Test team", 3, 3],
      ["Orlando Scrappers", 1, 4],
    ]);
  });

  it("charges both schedules when both listed the game", () => {
    const both = {
      ...filed,
      games: [
        {
          ...game("b1", "S-FAKE", "S-REAL", "2027-07-31", true, "WpYo8bR3Smwp"),
          alsoFrom: ["lvvjCaqPngbP"],
        },
      ],
    };
    expect(unrealClubs(both, TODAY).map((club) => club.name)).toEqual([
      "Orlando Scrappers",
      "Test team",
    ]);
  });

  it("charges both sides of a game nothing traces to a schedule", () => {
    const orphan = {
      ...filed,
      games: [game("o1", "S-FAKE", "S-REAL", "2027-07-31", true, "gone00000000")],
    };
    expect(unrealClubs(orphan, TODAY)).toHaveLength(2);
  });
});

describe("the clubs behind results dated ahead", () => {
  const found = unrealClubs(pool, TODAY);

  it("lists them worst first, with how much of the record is impossible", () => {
    expect(found.map((club) => [club.name, club.ahead, club.played])).toEqual([
      // S-REAL is on every one of these rows, so it carries the most.
      ["Orlando Scrappers", 3, 5],
      ["Test team", 2, 2],
      ["Mostly Fine", 1, 3],
    ]);
  });

  it("carries what a deletion has to remember", () => {
    const fake = found.find((club) => club.name === "Test team")!;

    expect(fake.gcTeamIds).toEqual(["WpYo8bR3Smwp"]);
    // Every row it is in, the unscored one included: the club's whole schedule goes with it.
    expect(fake.gameIds.sort()).toEqual(["g1", "g2", "g3"]);
  });

  it("says nothing about a pool with no impossible games", () => {
    const clean = { ...pool, games: [game("g5", "S-ODD", "S-REAL", "2026-08-20")] };

    expect(unrealClubs(clean, TODAY)).toEqual([]);
  });
});

describe("a club that has been thrown out", () => {
  const schedule: GcTeamSchedule = {
    profile: {
      id: "WpYo8bR3Smwp",
      name: "Test team 11U",
      ageLevel: 11,
      season: { season: "winter", year: 2026 },
      state: "FL",
    },
    games: [
      {
        id: "x1",
        date: "2027-07-31",
        opponentName: "Orlando Scrappers",
        status: "completed",
        teamScore: 11,
        opponentScore: 0,
      },
      /*
       * One game already played. Without it this schedule is nothing but results from the future,
       * which the import now refuses as invented before anybody has to delete it (see
       * `isInventedSchedule`); with it, it is a club with a date typed wrong, which is what the
       * list and a person are still for.
       */
      {
        id: "x0",
        date: "2026-09-12",
        opponentName: "Orlando Scrappers",
        status: "completed",
        teamScore: 3,
        opponentScore: 2,
      },
    ],
    fetchedAt: "2026-09-20T03:35:17.077Z",
  };
  const empty: GcImportState = { ageGroups: [], teams: [], games: [] };

  it("is pulled like any other until it is deleted", () => {
    const importer = createGcImporter(empty, { today: "2026-09-20" });
    const outcome = importer.add(schedule);

    expect(outcome.skip).toBeUndefined();
    expect(importer.state.games).toHaveLength(2);
  });

  it("has its schedule refused, so the pull cannot rebuild it", () => {
    /*
     * Refused before a game is read. Nothing later can do this: the rows would be filed and the
     * team rebuilt from the profile, and the deletion undone by the very pull meant to keep the
     * pool clean.
     */
    const dropped = forgetClubs(new Set<string>(), ["WpYo8bR3Smwp"]);
    const importer = createGcImporter(empty, { droppedClubs: dropped });
    const outcome = importer.add(schedule);

    expect(outcome.skip).toBe("deleted");
    expect(importer.state.games).toEqual([]);
    expect(importer.state.teams).toEqual([]);
  });

  it("can be let back in", () => {
    const dropped = forgetClubs(new Set<string>(), ["WpYo8bR3Smwp"]);

    expect(isDeletedClub(dropped, "WpYo8bR3Smwp")).toBe(true);
    expect(isDeletedClub(restoreClubs(dropped, ["WpYo8bR3Smwp"]), "WpYo8bR3Smwp")).toBe(false);
  });
});
