import { describe, expect, it } from "vitest";
import type { GcImportState } from "../gameChangerImport";
import { aheadWorstFirst, clubOf, poolHealthSummary } from "../poolHealthSummary";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";
import { unrealClubs, type UnrealClub } from "../unrealClubs";

/*
 * What Pool health shows as it opens (`poolHealthSummary.ts`), from a device's pool or the
 * server's: the rows scored ahead and won by too much, with the year each is stored under and the
 * clubs that filed it, and the clubs those rows belong to. Placeholder names throughout.
 */

const TODAY = "2027-04-15";
const GROUPS: AgeGroup[] = [
  { id: "ag_10u_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  { id: "ag_loose", name: "Loose", ageLevel: 10, seasonIds: [] },
];
const link = (teamId: string, name: string) => ({ teamId, name, ageGroupId: "ag_10u_2027" });
const TEAMS: ScoutTeam[] = [
  { id: "A", name: "Club A", gcTeams: [link("gcA", "Club A")] },
  { id: "B", name: "Club B", gcTeams: [link("gcB", "Club B"), link("gcB2", "Club B 2")] },
  { id: "C", name: "Club C" },
];
const filed = (gcId: string) => ({ kind: "gamechanger" as const, teamId: gcId, gameId: "x" });
const GAMES: ScoutGame[] = [
  // Scored on a day still to come, filed by A's schedule.
  {
    id: "ahead-1",
    ageGroupId: "ag_10u_2027",
    teamAId: "A",
    teamBId: "B",
    teamAScore: 3,
    teamBScore: 2,
    date: "2027-05-01",
    source: filed("gcA"),
  },
  // One both schedules scored, which goes under whichever club is the worse.
  {
    id: "ahead-both",
    ageGroupId: "ag_10u_2027",
    teamAId: "A",
    teamBId: "B",
    teamAScore: 4,
    teamBScore: 4,
    date: "2027-05-02",
    source: filed("gcA"),
    alsoRows: [{ teamId: "gcB", gameId: "y", ownScore: 4, opponentScore: 4 }],
  },
  // And one filed by B's, on a page with no year.
  {
    id: "ahead-2",
    ageGroupId: "ag_loose",
    teamAId: "B",
    teamBId: "C",
    teamAScore: 1,
    teamBScore: 0,
    date: "2027-04-20",
    source: filed("gcB"),
  },
  // Not scored: a fixture to come is no sign of anything.
  { id: "fixture", ageGroupId: "ag_10u_2027", teamAId: "C", teamBId: "A", date: "2027-05-02" },
  // Won by more than thirty, the wider first once listed.
  {
    id: "rout-34",
    ageGroupId: "ag_10u_2027",
    teamAId: "B",
    teamBId: "C",
    teamAScore: 35,
    teamBScore: 1,
    date: "2027-03-02",
    source: filed("gcB"),
  },
  {
    id: "rout-40",
    ageGroupId: "ag_10u_2027",
    teamAId: "A",
    teamBId: "C",
    teamAScore: 40,
    teamBScore: 0,
    date: "2027-03-01",
    source: filed("gcA"),
  },
  // Vouched for at its margin: it counts, and no list names it.
  {
    id: "rout-vouched",
    ageGroupId: "ag_10u_2027",
    teamAId: "A",
    teamBId: "C",
    teamAScore: 31,
    teamBScore: 0,
    scoreConfirmed: 31,
    date: "2027-03-03",
  },
];
const POOL: GcImportState = { ageGroups: GROUPS, teams: TEAMS, games: GAMES };
const STORED = [{ year: 2027, games: 5 }];

describe("what Pool health shows as it opens", () => {
  const summary = poolHealthSummary(POOL, TODAY, STORED);

  it("lists the results scored ahead, with the year each is stored under and who filed it", () => {
    expect(summary.datedAhead).toEqual([
      {
        id: "ahead-1",
        date: "2027-05-01",
        teamAId: "A",
        teamBId: "B",
        teamAScore: 3,
        teamBScore: 2,
        year: 2027,
        filers: ["A"],
      },
      {
        id: "ahead-both",
        date: "2027-05-02",
        teamAId: "A",
        teamBId: "B",
        teamAScore: 4,
        teamBScore: 4,
        year: 2027,
        filers: ["A", "B"],
      },
      {
        id: "ahead-2",
        date: "2027-04-20",
        teamAId: "B",
        teamBId: "C",
        teamAScore: 1,
        teamBScore: 0,
        year: null,
        filers: ["B"],
      },
    ]);
  });

  it("lists the games won by more than thirty, widest first, leaving out a margin vouched for", () => {
    expect(summary.implausible.map(({ game, margin }) => [game.id, margin])).toEqual([
      ["rout-40", 40],
      ["rout-34", 34],
    ]);
  });

  it("names the suspected clubs as the page's own list does, and every club a row names", () => {
    expect(summary.suspected).toEqual(unrealClubs(POOL, TODAY));
    expect(summary.clubs).toEqual({
      A: { name: "Club A", gcId: "gcA" },
      B: { name: "Club B", gcId: "gcB" },
      C: { name: "Club C" },
    });
    // Only its own entries: an id every object answers to is none of them.
    expect(clubOf(summary, "constructor")).toBeUndefined();
    expect(clubOf(summary, "B")).toEqual({ name: "Club B", gcId: "gcB" });
    expect(summary.holdings).toEqual([
      { year: 2027, pages: 1, teams: 2, games: 5, emptied: false },
      { year: undefined, pages: 1, teams: 0, games: 0, emptied: false },
    ]);
  });

  it("puts the rows scored ahead under the worst club that filed them, first", () => {
    const club = (teamId: string): UnrealClub => {
      const found = summary.suspected.find((one) => one.teamId === teamId);
      if (!found) throw new Error(`${teamId} is not suspected`);
      return found;
    };
    const rows = (unreal: UnrealClub[]) =>
      aheadWorstFirst(summary, unreal).map(({ game, filer, gcId }) => [game.id, filer, gcId]);
    // B the worse: the row both filed goes under B, and B's rows come first, in date order.
    expect(rows([club("B"), club("A")])).toEqual([
      ["ahead-2", "B", "gcB"],
      ["ahead-both", "B", "gcB"],
      ["ahead-1", "A", "gcA"],
    ]);
    expect(rows([club("A"), club("B")])).toEqual([
      ["ahead-1", "A", "gcA"],
      ["ahead-both", "A", "gcA"],
      ["ahead-2", "B", "gcB"],
    ]);
    // A club nobody suspects puts its rows last.
    expect(aheadWorstFirst(summary, [])[0]?.at).toBe(Infinity);
  });
});
