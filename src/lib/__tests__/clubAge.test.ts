import { describe, expect, it } from "vitest";
import { setClubAge, type ClubAgeState } from "../clubAge";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/**
 * A club filed a year too young: its own schedule's rows sit on the 8U page, while the league it
 * plays in, and the other clubs' copies of its games, are on 9U. Invented names throughout.
 */
const page = (level: number, year: number): AgeGroup => ({
  id: `ag_${level}u_${year}`,
  name: `${level}U ${year}`,
  ageLevel: level,
  year,
  seasonIds: [],
});
const u8 = page(8, 2027);
const u9 = page(9, 2027);
const lastYear = page(8, 2026);

const club: ScoutTeam = {
  id: "S-HIVE",
  name: "Example Hive *Fall Ball*",
  gcTeams: [
    {
      teamId: "gcHIVEFALL26",
      name: "Example Hive *Fall Ball*",
      ageGroupId: u8.id,
      season: "fall",
      seasonYear: 2026,
      ageLevel: 8,
    },
    // Last year's id, which a level set for this year leaves alone.
    {
      teamId: "gcHIVEFALL25",
      name: "Example Hive",
      ageGroupId: lastYear.id,
      season: "fall",
      seasonYear: 2025,
      ageLevel: 8,
    },
  ],
};
const others: ScoutTeam[] = [
  { id: "S-OWLS", name: "Owls" },
  { id: "S-FOXES", name: "Foxes" },
];

const own = (id: string, opponent: string, extra: Partial<ScoutGame> = {}): ScoutGame => ({
  id,
  teamAId: club.id,
  teamBId: opponent,
  ageGroupId: u8.id,
  date: "2026-09-12",
  ageLevelA: 8,
  ageLevelB: 9,
  source: { kind: "gamechanger", teamId: "gcHIVEFALL26", gameId: id },
  ...extra,
});

const state = (): ClubAgeState => ({
  ageGroups: [u8, u9, lastYear],
  teams: [club, ...others],
  games: [
    own("g1", "S-OWLS", { teamAScore: 5, teamBScore: 9 }),
    own("g2", "S-FOXES"),
    // The Owls' own copy of a game, on their page, naming no age for this club.
    {
      id: "g3",
      teamAId: "S-OWLS",
      teamBId: club.id,
      ageGroupId: u9.id,
      date: "2026-09-19",
      ageLevelA: 9,
      source: { kind: "gamechanger", teamId: "gcOWLSFALL26", gameId: "g3" },
    },
    // The Foxes' copy of another, which read an age for this club off the name it saw.
    {
      id: "g4",
      teamAId: "S-FOXES",
      teamBId: club.id,
      ageGroupId: u8.id,
      date: "2026-09-26",
      ageLevelA: 9,
      ageLevelB: 8,
      source: { kind: "gamechanger", teamId: "gcFOXESFALL26", gameId: "g4" },
    },
    // Last year's game, under last year's id.
    own("g5", "S-OWLS", {
      ageGroupId: lastYear.id,
      date: "2025-09-13",
      source: { kind: "gamechanger", teamId: "gcHIVEFALL25", gameId: "g5" },
    }),
  ],
});

const byId = (games: ScoutGame[], id: string) => games.find((game) => game.id === id);

describe("setting the age a club plays at", () => {
  it("moves its own rows to that page and its side of every game it was given an age in", () => {
    const before = state();
    const change = setClubAge(before, club.id, 9, 2027);
    expect(change).not.toBeNull();
    if (!change) return;

    expect(change.gcTeamIds).toEqual(["gcHIVEFALL26"]);
    expect(change.was).toBe(8);
    expect(change.page).toBe(u9);
    expect(change.moved).toBe(2);

    // Its own schedule's rows: onto the 9U page, with its side at 9.
    expect(byId(change.games, "g1")).toMatchObject({ ageGroupId: u9.id, ageLevelA: 9 });
    expect(byId(change.games, "g2")).toMatchObject({ ageGroupId: u9.id, ageLevelA: 9 });
    // The opponent's side is the opponent's, and stays as it was.
    expect(byId(change.games, "g1")?.ageLevelB).toBe(9);
    // Another club's row stays on the page it was filed on. One that named no age for this club
    // still names none; one that read 8 off the name now says 9.
    expect(byId(change.games, "g3")).toEqual(byId(before.games, "g3"));
    expect(byId(change.games, "g4")).toMatchObject({ ageGroupId: u8.id, ageLevelB: 9 });
    // Last year is another id and another year.
    expect(byId(change.games, "g5")).toBe(byId(before.games, "g5"));

    const link = (teams: ScoutTeam[], gcTeamId: string) =>
      teams.find((team) => team.id === club.id)?.gcTeams?.find((l) => l.teamId === gcTeamId);
    expect(link(change.teams, "gcHIVEFALL26")).toMatchObject({ ageGroupId: u9.id, ageLevel: 9 });
    expect(link(change.teams, "gcHIVEFALL25")).toEqual(link(before.teams, "gcHIVEFALL25"));
    expect(change.ageGroups).toBe(before.ageGroups);
  });

  it("makes the page when there is not one yet", () => {
    const change = setClubAge(state(), club.id, 10, 2027);
    expect(change?.page).toMatchObject({ name: "10U 2027", ageLevel: 10, year: 2027 });
    expect(change?.ageGroups).toHaveLength(4);
    expect(byId(change?.games ?? [], "g1")?.ageGroupId).toBe(change?.page.id);
  });

  it("changes nothing where the club already is", () => {
    const before = state();
    const change = setClubAge(before, club.id, 8, 2027);
    // Only the Foxes' row said anything else about it, and it said 8 as well.
    expect(change?.games).toBe(before.games);
    expect(change?.teams).toBe(before.teams);
    expect(change?.ageGroups).toBe(before.ageGroups);
    expect(change?.moved).toBe(0);
  });

  it("refuses a club with no GameChanger id that year, and a level the app does not rank", () => {
    expect(setClubAge(state(), "S-OWLS", 9, 2027)).toBeNull();
    expect(setClubAge(state(), club.id, 9, 2028)).toBeNull();
    expect(setClubAge(state(), club.id, 7, 2027)).toBeNull();
    expect(setClubAge(state(), club.id, 19, 2027)).toBeNull();
    expect(setClubAge(state(), club.id, 9.5, 2027)).toBeNull();
  });
});

describe("what the links say decided the level", () => {
  it("says you when somebody sets it, and nothing once it is handed back", () => {
    const set = setClubAge(state(), club.id, 9, 2027, "you");
    const link = set?.teams.find((one) => one.id === club.id)?.gcTeams?.[0];
    expect(link).toMatchObject({ ageLevel: 9, ageFrom: "you" });

    const back = setClubAge(set!, club.id, 8, 2027, null);
    const after = back?.teams.find((one) => one.id === club.id)?.gcTeams?.[0];
    expect(after?.ageLevel).toBe(8);
    expect(after && "ageFrom" in after).toBe(false);
    // Last year's id keeps whatever it had.
    expect(back?.teams.find((one) => one.id === club.id)?.gcTeams?.[1]).toEqual(club.gcTeams?.[1]);
  });
});
