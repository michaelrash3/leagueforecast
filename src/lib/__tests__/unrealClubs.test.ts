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

const game = (id: string, a: string, b: string, date: string, scored = true): ScoutGame => ({
  id,
  teamAId: a,
  teamBId: b,
  ageGroupId: group.id,
  date,
  ...(scored ? { teamAScore: 11, teamBScore: 0 } : {}),
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
    ],
    fetchedAt: "2026-09-20T03:35:17.077Z",
  };
  const empty: GcImportState = { ageGroups: [], teams: [], games: [] };

  it("is pulled like any other until it is deleted", () => {
    const importer = createGcImporter(empty);
    const outcome = importer.add(schedule);

    expect(outcome.skip).toBeUndefined();
    expect(importer.state.games).toHaveLength(1);
  });

  it("has its schedule refused, so the pull cannot rebuild it", () => {
    /*
     * Refused before a game is read. Nothing later can do this: the rows would be filed and the
     * team rebuilt from the profile, and the deletion undone by the very pull meant to keep the
     * pool clean.
     */
    const dropped = forgetClubs(new Set<string>(), ["WpYo8bR3Smwp"]);
    const importer = createGcImporter(empty, new Set<string>(), dropped);
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
