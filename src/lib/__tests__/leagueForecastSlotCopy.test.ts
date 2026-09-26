import { describe, expect, it } from "vitest";
import {
  finalScoresKey,
  leagueFixturesOf,
  leagueScoutBridge,
  type AgeGroup,
  type LeagueFixture,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";
import type { GameLog } from "../types";

/*
 * The league's forecast reads outside results from Team Rankings and leaves out the league's own
 * games. A club's own row filed against "TBD" shares no names with the league's fixture, so it
 * read as a tournament result and the forecast counted the league's game twice: 513 Force -
 * Bouley's 0-13 to the Hornets on 25 September, and the Angels' and Headlines Nagel's games with
 * 513 Force, which their schedules filed against a "513 Force" known by no other name.
 */
const ageGroups: AgeGroup[] = [
  { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: ["fall"] },
];
const pulled = (id: string, name: string, gcId: string): ScoutTeam => ({
  id,
  name,
  gcTeams: [{ teamId: gcId, name, ageGroupId: "ag9" }],
});
const teams: ScoutTeam[] = [
  pulled("S-513", "513 FORCE - BOULEY", "gc513"),
  pulled("S-HORN", "Cincinnati Hornets", "gcHORN"),
  { id: "S-TBD", name: "TBD- 09/25/26, 7:15 PM", placeholder: true },
  { id: "S-513-SI", name: "513 Force", nameOnly: true },
];
const row = (
  id: string,
  a: string,
  b: string,
  date: string,
  sa: number,
  sb: number,
  schedule?: string
): ScoutGame => ({
  id,
  ageGroupId: "ag9",
  teamAId: a,
  teamBId: b,
  date,
  teamAScore: sa,
  teamBScore: sb,
  ...(schedule ? { source: { kind: "gamechanger" as const, teamId: schedule, gameId: id } } : {}),
});
const leagueTeams = [
  { id: "L-513", name: "513 FORCE - BOULEY" },
  { id: "L-HORN", name: "Cincinnati Hornets" },
];
/** 513 Force at the Hornets on 25 September, final 0-13. */
const final: LeagueFixture = {
  away: "513 FORCE - BOULEY",
  home: "Cincinnati Hornets",
  date: "9/25",
  awayRuns: 0,
  homeRuns: 13,
};
/** 513 Force's own row: against a slot, 0-13. */
const againstTbd = row("gc_513_1", "S-513", "S-TBD", "2026-09-25", 0, 13, "gc513");
/** Something the Hornets played elsewhere, so both clubs are on the season's page. */
const hornetsElsewhere = row("gc_horn_9", "S-HORN", "S-TBD", "2026-09-06", 5, 1, "gcHORN");
const resultsOf = (games: ScoutGame[], fixtures: LeagueFixture[], league = leagueTeams) =>
  leagueScoutBridge("fall", ageGroups, teams, games, league, fixtures).results;

describe("a league club's own row filed against nobody, in the league's forecast", () => {
  it("is the league's own game, not an outside result, once the league has its score", () => {
    const results = resultsOf([againstTbd, hornetsElsewhere], [final]);
    expect(results.map((result) => result.date)).toEqual(["2026-09-06"]);
  });

  it("is still an outside result while the league has no score for it", () => {
    const { awayRuns: _away, homeRuns: _home, ...unscored } = final;
    const results = resultsOf([againstTbd, hornetsElsewhere], [unscored]);
    expect(results.map((result) => result.date).sort()).toEqual(["2026-09-06", "2026-09-25"]);
  });

  it("is the league's game from a stand-in whose name fits the league team's", () => {
    // The Hornets' own schedule named them "513 Force": 13-0 from the Hornets' seat.
    const hornetsRow = row("gc_horn_1", "S-HORN", "S-513-SI", "2026-09-25", 13, 0, "gcHORN");
    const results = resultsOf([againstTbd, hornetsRow, hornetsElsewhere], [final]);
    expect(results.map((result) => result.date)).toEqual(["2026-09-06"]);
  });

  it("pairs even when the league's opponent has no club behind it", () => {
    // The Hornets are not linked to anything in the pool; the slot row still pairs by 513 Force.
    const league = [leagueTeams[0]!, { id: "L-HORN", name: "Hornets Nobody Pulled" }];
    const fixture = { ...final, home: "Hornets Nobody Pulled" };
    expect(resultsOf([againstTbd], [fixture], league)).toEqual([]);
  });

  it("leaves a game typed in by hand against TBD in the results", () => {
    const typed = row("m_typed_1", "S-513", "S-TBD", "2026-09-25", 0, 13);
    const results = resultsOf([typed, hornetsElsewhere], [final]);
    expect(results.map((result) => result.date).sort()).toEqual(["2026-09-06", "2026-09-25"]);
  });
});

describe("the fixtures the bridge is handed", () => {
  const log = (awayRuns: string, homeRuns: string, isFinal: boolean, awayHits = ""): GameLog => ({
    awayRuns,
    awayHits,
    awayK: "",
    homeRuns,
    homeHits: "",
    homeK: "",
    innings: "6",
    isFinal,
  });
  const matchups = [
    { id: "m1", date: "9/25", away: "L-513", home: "L-HORN" },
    { id: "m2", date: "10/2", away: "L-HORN", home: "L-513" },
  ];

  it("carry the runs of a final game and none of a game still in progress", () => {
    const logs = { m1: log("0", "13", true), m2: log("4", "2", false) };
    expect(leagueFixturesOf(leagueTeams, matchups, finalScoresKey(matchups, logs))).toEqual([
      final,
      { away: "Cincinnati Hornets", home: "513 FORCE - BOULEY", date: "10/2" },
    ]);
  });

  it("change only when a final result does", () => {
    const before = finalScoresKey(matchups, { m1: log("0", "13", true), m2: log("4", "", false) });
    // A score typed into a game still in progress, and a hit added to a finished one.
    const typing = finalScoresKey(matchups, {
      m1: log("0", "13", true, "3"),
      m2: log("4", "2", false),
    });
    expect(typing).toBe(before);
    const finished = finalScoresKey(matchups, {
      m1: log("0", "13", true),
      m2: log("4", "2", true),
    });
    expect(finished).not.toBe(before);
  });
});
