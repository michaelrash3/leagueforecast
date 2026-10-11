import { describe, expect, it } from "vitest";
import type { GcImportState } from "../gameChangerImport";
import { aheadWorstFirst, clubOf, poolHealthSummary } from "../poolHealthSummary";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";
import { unrealClubs, type UnrealClub } from "../unrealClubs";
import { NO_REMOVALS, type AutoRemoval } from "../autoRemoved";

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
  const summary = poolHealthSummary(POOL, TODAY, STORED, NO_REMOVALS, new Set());

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

describe("the clubs taken off as plainly made up, in Pool health", () => {
  const mark = (
    gcTeamId: string,
    on: string,
    more: Partial<AutoRemoval>
  ): [string, AutoRemoval] => [
    gcTeamId,
    { gcTeamId, name: "Club A", on, signs: ["named"], word: "test", ...more },
  ];
  const marks = new Map([
    mark("gcA", "2027-04-10", {}),
    mark("gcB", "2027-04-12", {
      name: "Club B",
      signs: ["wins"],
      word: undefined,
      wins: [
        { gameId: "x", margin: 44 },
        { gameId: "y", margin: 43 },
      ],
    }),
  ]);

  it("leaves a club off every list once every one of its ids is marked, and lists it apart", () => {
    const summary = poolHealthSummary(
      POOL,
      TODAY,
      STORED,
      new Map([mark("gcA", "2027-04-10", {})]),
      new Set()
    );
    // A's rows go from every list, and A from the suspects; B's stay.
    expect(summary.datedAhead.map((game) => game.id)).toEqual(["ahead-2"]);
    expect(summary.implausible.map(({ game }) => game.id)).toEqual(["rout-34"]);
    expect(summary.suspected.map((club) => club.teamId)).toEqual(["B"]);
    expect(summary.removed).toEqual([
      {
        teamId: "A",
        name: "Club A",
        gcTeamIds: ["gcA"],
        on: "2027-04-10",
        reasons: ["named 'test'"],
      },
    ]);
  });

  it("keeps a club a League Standings team links on every list, and says it is kept", () => {
    const summary = poolHealthSummary(
      POOL,
      TODAY,
      STORED,
      new Map([mark("gcA", "2027-04-10", {})]),
      new Set(["A"])
    );
    expect(summary.datedAhead.map((game) => game.id)).toContain("ahead-1");
    expect(summary.suspected.map((club) => club.teamId)).toContain("A");
    expect(summary.removed?.map((club) => [club.teamId, club.keptByLeague])).toEqual([["A", true]]);
  });

  it("lists them newest first, and none with no marks or one of a club's two ids", () => {
    const both = new Map([...marks, mark("gcB2", "2027-04-11", { name: "Club B" })]);
    expect(
      poolHealthSummary(POOL, TODAY, STORED, both, new Set()).removed?.map((club) => club.teamId)
    ).toEqual(["B", "A"]);
    expect(
      poolHealthSummary(POOL, TODAY, STORED, marks, new Set()).removed?.map((club) => club.teamId)
    ).toEqual(["A"]);
    expect(poolHealthSummary(POOL, TODAY, STORED, NO_REMOVALS, new Set()).removed).toEqual([]);
  });
});
