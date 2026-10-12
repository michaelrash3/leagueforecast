import { describe, expect, it } from "vitest";
import { listCoverage, unpulledClubs, unpulledClubsCsv } from "../unpulledClubs";
import type { GcImportState } from "../gameChangerImport";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

const groups: AgeGroup[] = [
  { id: "ag_11_2027", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] },
  { id: "ag_12_2027", name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [] },
];

const pulled = (id: string, name: string, state?: string): ScoutTeam => ({
  id,
  name,
  ...(state ? { state } : {}),
  gcTeams: [{ teamId: `gc-${id}`, name, ageGroupId: "ag_11_2027" }],
});

const heard = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });

const game = (
  id: string,
  ageGroupId: string,
  a: string,
  b: string,
  extra: Partial<ScoutGame> = {}
): ScoutGame => ({ id, ageGroupId, teamAId: a, teamBId: b, date: "2026-09-12", ...extra });

const pool = (teams: ScoutTeam[], games: ScoutGame[]): GcImportState => ({
  ageGroups: groups,
  teams,
  games,
});

describe("the clubs worth pulling next", () => {
  const state = () =>
    pool(
      [
        pulled("S-HOME", "Home Club", "KY"),
        pulled("S-OTHER", "Other Club", "OH"),
        heard("S-HEARD", "Heard Of Only"),
        heard("S-QUIET", "Quiet Club"),
        { id: "S-TBD", name: "TBD", placeholder: true },
      ],
      [
        game("g1", "ag_11_2027", "S-HOME", "S-HEARD", { teamAScore: 6, teamBScore: 2 }),
        game("g2", "ag_11_2027", "S-OTHER", "S-HEARD", { teamAScore: 1, teamBScore: 4 }),
        game("g3", "ag_12_2027", "S-HOME", "S-HEARD"),
        game("g4", "ag_11_2027", "S-HOME", "S-QUIET", { teamAScore: 3, teamBScore: 2 }),
        game("g5", "ag_11_2027", "S-HOME", "S-TBD", { teamAScore: 9, teamBScore: 0 }),
      ]
    );

  it("lists only clubs somebody named, never a placeholder", () => {
    const clubs = unpulledClubs(state());
    expect(clubs.map((club) => club.name)).toEqual(["Heard Of Only", "Quiet Club"]);
  });

  it("never asks for a club the importer would refuse on sight", () => {
    /*
     * This is a to-do list, so a name on it the importer refuses sends somebody off to find a
     * GameChanger id for a team that can never be filed. High school squads are the ones it
     * really happens to: a varsity side turns up as an opponent and becomes a stand-in, where a
     * wiffle team never could, because a wiffle game is dropped before an opponent is resolved.
     */
    const clubs = unpulledClubs(
      pool(
        [
          pulled("S-HOME", "Home Club", "KY"),
          heard("S-HEARD", "Heard Of Only"),
          heard("S-SCHOOL", "Lincoln HS Varsity"),
          heard("S-PLASTIC", "Wiffle Ball 12U"),
        ],
        [
          game("g1", "ag_11_2027", "S-HOME", "S-HEARD", { teamAScore: 6, teamBScore: 2 }),
          game("g2", "ag_11_2027", "S-HOME", "S-SCHOOL", { teamAScore: 1, teamBScore: 4 }),
          game("g3", "ag_11_2027", "S-HOME", "S-PLASTIC", { teamAScore: 9, teamBScore: 0 }),
        ]
      )
    );
    expect(clubs.map((club) => club.name)).toEqual(["Heard Of Only"]);
  });

  it("puts the one holding the most results first", () => {
    // A stand-in holding two results costs two games; one holding one costs one.
    const [first] = unpulledClubs(state());
    expect(first).toMatchObject({ name: "Heard Of Only", played: 2, games: 3 });
  });

  it("borrows where it is from off the clubs that named it", () => {
    const [first] = unpulledClubs(state());
    // A club plays its neighbours, so this is the best guess at where to look for it.
    expect(first?.states).toEqual(["KY", "OH"]);
  });

  it("says which age levels and seasons its games sit on", () => {
    const [first] = unpulledClubs(state());
    expect(first?.levels).toEqual([11, 12]);
    expect(first?.years).toEqual([2027]);
  });

  it("names who played it, so the schedule can be found from there", () => {
    const [first] = unpulledClubs(state());
    expect(first?.namedBy.sort()).toEqual(["Home Club", "Other Club"]);
  });

  it("has nothing to say about a pool where every club was pulled", () => {
    const everyone = pool(
      [pulled("S-A", "A"), pulled("S-B", "B")],
      [game("g1", "ag_11_2027", "S-A", "S-B", { teamAScore: 1, teamBScore: 0 })]
    );
    expect(unpulledClubs(everyone)).toEqual([]);
  });

  it("skips a club whose name was lost, which nothing could look up", () => {
    const nameless = pool(
      [pulled("S-A", "A"), heard("S-X", "")],
      [game("g1", "ag_11_2027", "S-A", "S-X", { teamAScore: 1, teamBScore: 0 })]
    );
    expect(unpulledClubs(nameless)).toEqual([]);
  });
});

describe("the list as a file", () => {
  it("writes a row per club, worth most first", () => {
    const clubs = unpulledClubs(
      pool(
        [pulled("S-HOME", "Home Club", "KY"), heard("S-HEARD", "Heard Of Only")],
        [game("g1", "ag_11_2027", "S-HOME", "S-HEARD", { teamAScore: 6, teamBScore: 2 })]
      )
    );
    const lines = unpulledClubsCsv(clubs).split("\n");
    expect(lines[0]).toBe("Team Name,Results Waiting,Games,States,Age Levels,Seasons,Named By");
    expect(lines[1]).toBe("Heard Of Only,1,1,KY,11U,2027,Home Club");
  });

  it("is a header and nothing else when there is nothing to pull", () => {
    expect(unpulledClubsCsv([]).split("\n")).toHaveLength(1);
  });

  it("quotes a name with a comma in it", () => {
    const clubs = unpulledClubs(
      pool(
        [pulled("S-HOME", "Home Club", "KY"), heard("S-HEARD", "Raptors, Junior")],
        [game("g1", "ag_11_2027", "S-HOME", "S-HEARD", { teamAScore: 6, teamBScore: 2 })]
      )
    );
    expect(unpulledClubsCsv(clubs)).toContain('"Raptors, Junior"');
  });
});

describe("what a team list would clear", () => {
  const backlog = () =>
    unpulledClubs(
      pool(
        [
          pulled("S-HOME", "Home Club", "KY"),
          heard("S-HEARD", "Heard Of Only"),
          heard("S-ONE", "One Game Only"),
        ],
        [
          game("g1", "ag_11_2027", "S-HOME", "S-HEARD", { teamAScore: 6, teamBScore: 2 }),
          game("g2", "ag_11_2027", "S-HOME", "S-HEARD", { teamAScore: 4, teamBScore: 3 }),
          game("g3", "ag_11_2027", "S-HOME", "S-ONE", { teamAScore: 1, teamBScore: 0 }),
        ]
      )
    );

  it("counts the entries that are clubs already standing in here", () => {
    const found = listCoverage(
      [
        { teamId: "gc1", name: "Heard Of Only" },
        { teamId: "gc2", name: "Somebody New" },
      ],
      backlog()
    );
    expect(found).toMatchObject({ standIns: 1, unheardOf: 1 });
  });

  it("adds up the results those clubs are holding", () => {
    const found = listCoverage(
      [
        { teamId: "gc1", name: "Heard Of Only" },
        { teamId: "gc2", name: "One Game Only" },
      ],
      backlog()
    );
    // Two results waiting on one, one on the other.
    expect(found.resultsWaiting).toBe(3);
  });

  it("counts a club's waiting results once however many listings name it", () => {
    const found = listCoverage(
      [
        { teamId: "gc1", name: "Heard Of Only" },
        { teamId: "gc2", name: "Heard Of Only" },
      ],
      backlog()
    );
    expect(found).toMatchObject({ standIns: 2, resultsWaiting: 2 });
  });

  it("says nothing is waiting when the list is all new ground", () => {
    const found = listCoverage([{ teamId: "gc1", name: "Nobody Here Knows Them" }], backlog());
    expect(found).toMatchObject({ standIns: 0, resultsWaiting: 0, unheardOf: 1 });
  });

  it("treats an entry with no name as new ground rather than a match", () => {
    expect(listCoverage([{ teamId: "gc1" }], backlog())).toMatchObject({
      standIns: 0,
      unheardOf: 1,
    });
  });
});
