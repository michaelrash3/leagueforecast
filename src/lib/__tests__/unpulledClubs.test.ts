import { describe, expect, it } from "vitest";
import { unpulledClubs, unpulledClubsCsv } from "../unpulledClubs";
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
