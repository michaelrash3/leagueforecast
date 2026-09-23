import { describe, expect, it } from "vitest";
import { deletableYears, deleteSquadYear } from "../deleteSquadYear";
import type { AgeGroup, GcTeamLink, ScoutGame, ScoutTeam } from "../teamRankings";
import type { ArchiveEntry } from "../teamRankingsArchive";

const page = (level: number, year: number, extra: Partial<AgeGroup> = {}): AgeGroup => ({
  id: `ag_${level}u_${year}`,
  name: `${level}U ${year}`,
  ageLevel: level,
  year,
  seasonIds: [],
  ...extra,
});

const link = (teamId: string, ageGroupId: string): GcTeamLink => ({
  teamId,
  name: teamId,
  ageGroupId,
});

const played = (id: string, ageGroupId: string, a: string, b: string): ScoutGame => ({
  id,
  ageGroupId,
  teamAId: a,
  teamBId: b,
  teamAScore: 5,
  teamBScore: 3,
});

const archived = (id: string, year: number): ArchiveEntry => ({
  id,
  name: id,
  year,
  archivedAt: "2026-07-31T00:00:00.000Z",
  fromGames: 10,
  fromTeams: 4,
  teams: 4,
});

/**
 * Two years at two ages. Aces play in both; Badgers and Cougars only in 2026; Nexters only in
 * 2027. The 2027 9U page carries its squad on from 2026's 8U, and 2026's 9U is linked to a league.
 */
const pool = () => {
  const ageGroups = [
    page(8, 2026),
    page(9, 2026, { seasonIds: ["league-fall-2025"] }),
    page(9, 2027, { continuesFromId: "ag_8u_2026" }),
  ];
  const teams: ScoutTeam[] = [
    {
      id: "S-A",
      name: "Aces",
      gcTeams: [link("gcACES2026", "ag_9u_2026"), link("gcACES2027", "ag_9u_2027")],
    },
    { id: "S-B", name: "Badgers", gcTeams: [link("gcBADG2026", "ag_9u_2026")] },
    { id: "S-C", name: "Cougars" },
    { id: "S-N", name: "Nexters", gcTeams: [link("gcNEXT2027", "ag_9u_2027")] },
    // Played in 2026 only through a page whose field has no year: its name says it.
    { id: "S-Y", name: "Yearless-field", gcTeams: [link("gcYEAR2026", "ag_named")] },
  ];
  const games = [
    played("g1", "ag_9u_2026", "S-A", "S-B"),
    played("g2", "ag_8u_2026", "S-B", "S-C"),
    played("g3", "ag_9u_2027", "S-A", "S-N"),
    played("g4", "ag_named", "S-Y", "S-C"),
  ];
  return {
    ageGroups: [...ageGroups, { id: "ag_named", name: "2026, 10U", seasonIds: [] }],
    teams,
    games,
  };
};

describe("deleting a squad year", () => {
  it("takes the year's pages and every game filed under them, and leaves the other year alone", () => {
    const done = deleteSquadYear(2026, pool(), []);
    expect(done.state.ageGroups.map((group) => group.id)).toEqual(["ag_9u_2027"]);
    expect(done.state.games.map((game) => game.id)).toEqual(["g3"]);
    expect(done.droppedGames).toBe(3);
    expect(done.pages).toEqual(["8U 2026", "9U 2026", "2026, 10U"]);
  });

  // `ageGroupYear`, not the field: a page rated with the year goes with it.
  it("takes a page whose name says the year when its field does not", () => {
    const done = deleteSquadYear(2026, pool(), []);
    expect(done.state.ageGroups.some((group) => group.id === "ag_named")).toBe(false);
    expect(done.state.teams.some((team) => team.id === "S-Y")).toBe(false);
  });

  it("takes the clubs that played in no other year", () => {
    const done = deleteSquadYear(2026, pool(), []);
    expect(done.state.teams.map((team) => team.id)).toEqual(["S-A", "S-N"]);
    expect(done.droppedTeams).toBe(3);
  });

  /*
   * A club in both years stays — one copy of a club is how a rename reaches both — but the ids its
   * 2026 squads were pulled as are this year's, and a link left to a page that is gone would be
   * the one trace of the year still in the pool.
   */
  it("keeps a club that plays in another year, without the ids it was pulled as in this one", () => {
    const done = deleteSquadYear(2026, pool(), []);
    const aces = done.state.teams.find((team) => team.id === "S-A");
    expect(aces?.gcTeams?.map((one) => one.teamId)).toEqual(["gcACES2027"]);
    expect(done.unlinkedTeams).toBe(1);
    // A club untouched by the year is the same object it was.
    const before = pool().teams.find((team) => team.id === "S-N");
    expect(done.state.teams.find((team) => team.id === "S-N")).toEqual(before);
  });

  it("drops the links field altogether when none is left", () => {
    const stored = pool();
    stored.teams[0] = { id: "S-A", name: "Aces", gcTeams: [link("gcACES2026", "ag_9u_2026")] };
    const done = deleteSquadYear(2026, stored, []);
    const aces = done.state.teams.find((team) => team.id === "S-A");
    expect(aces).toEqual({ id: "S-A", name: "Aces" });
  });

  it("clears a page's carry-on from a page that is gone", () => {
    const done = deleteSquadYear(2026, pool(), []);
    expect(done.state.ageGroups[0]).toEqual(page(9, 2027));
  });

  it("says which league seasons stop feeding a ranking, without touching them", () => {
    expect(deleteSquadYear(2026, pool(), []).leagueSeasonIds).toEqual(["league-fall-2025"]);
    expect(deleteSquadYear(2027, pool(), []).leagueSeasonIds).toEqual([]);
  });

  it("takes the year's archived tables and no other year's", () => {
    const tables = [archived("arc_2026_9u", 2026), archived("arc_2025_9u", 2025)];
    expect(deleteSquadYear(2026, pool(), tables).archiveIds).toEqual(["arc_2026_9u"]);
    // A year that is only archived tables now still has those to delete.
    const onlyArchived = deleteSquadYear(2025, pool(), tables);
    expect(onlyArchived.archiveIds).toEqual(["arc_2025_9u"]);
    expect(onlyArchived.pages).toEqual([]);
    expect(onlyArchived.state.games).toHaveLength(4);
  });
});

describe("the years there is anything to delete", () => {
  it("are the years with a page or an archived table, newest first", () => {
    expect(deletableYears(pool().ageGroups, [archived("arc_2024", 2024)])).toEqual([
      2027, 2026, 2024,
    ]);
  });
});
