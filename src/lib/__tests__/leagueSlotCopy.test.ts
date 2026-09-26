import { describe, expect, it } from "vitest";
import {
  buildTeamRankings,
  dedupeLeagueFixtures,
  leagueStandIns,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

/*
 * A club's own copy of a league game, filed against nobody the league names.
 *
 * The case that found it: 513 Force - Bouley's GameChanger schedule had its 25 September game at
 * 7:15 against "TBD- 09/25/26, 7:15 PM", a slot, and the league has the same game against the
 * Cincinnati Hornets, whose own schedule is not in the pool. Two pairs of clubs, so the collapse
 * by fixture could not see one game, and the team panel showed two 0-13 losses that day.
 */
/** A club pulled from GameChanger under the one id given. */
const pulled = (id: string, name: string, gcId: string): ScoutTeam => ({
  id,
  name,
  gcTeams: [{ teamId: gcId, name, ageGroupId: "ag9" }],
});
const teams: ScoutTeam[] = [
  pulled("S-513", "513 FORCE - BOULEY", "gc513"),
  pulled("S-HORN", "Cincinnati Hornets", "gcHORN"),
  { id: "S-TBD", name: "TBD- 09/25/26, 7:15 PM", placeholder: true },
  { id: "S-HORN-SI", name: "Hornets", nameOnly: true },
  { id: "S-DRAG-SI", name: "Dragons", nameOnly: true },
  pulled("S-OTHER", "Some Pulled Club", "gcOTHER"),
];
const row = (
  id: string,
  a: string,
  b: string,
  date: string,
  sa?: number,
  sb?: number,
  /** The GameChanger schedule the row was pulled from; none for a league row or one typed in. */
  schedule?: string
): ScoutGame => ({
  id,
  ageGroupId: "ag9",
  teamAId: a,
  teamBId: b,
  date,
  ...(sa === undefined || sb === undefined ? {} : { teamAScore: sa, teamBScore: sb }),
  ...(schedule ? { source: { kind: "gamechanger" as const, teamId: schedule, gameId: id } } : {}),
});
/** The league's copy: away 513 Force, home the Hornets, 0-13. */
const league = row("league_default_m7", "S-513", "S-HORN", "2026-09-25", 0, 13);
/** The club's own copy, against the slot its schedule was left with. */
const againstTbd = row("gc_513_1", "S-513", "S-TBD", "2026-09-25", 0, 13, "gc513");
const collapse = (games: ScoutGame[]) => dedupeLeagueFixtures(games, leagueStandIns(teams));

describe("a league game a club's schedule filed against nobody", () => {
  it("is one game with the league's copy when the club, the day and the score agree", () => {
    expect(collapse([league, againstTbd])).toEqual([league]);
  });

  it("counts once on the board", () => {
    const rows = buildTeamRankings("ag9", teams, collapse([league, againstTbd]));
    const force = rows.find((entry) => entry.teamId === "S-513")!;
    expect(force.record).toBe("0-1");
    expect(force.games).toBe(1);
  });

  it("is the league's game from either seat", () => {
    // The home side filed it: the Hornets' own row against a slot, 13-0 from their seat.
    const hornetsRow = row("gc_horn_1", "S-TBD", "S-HORN", "2026-09-25", 0, 13, "gcHORN");
    expect(collapse([league, hornetsRow])).toEqual([league]);
  });

  it("is also a club known only by a name that fits the opponent's", () => {
    const againstStandIn = row("gc_513_2", "S-513", "S-HORN-SI", "2026-09-25", 0, 13, "gc513");
    expect(collapse([league, againstStandIn])).toEqual([league]);
  });

  it("is not a stand-in whose name is somebody else's", () => {
    const againstDragons = row("gc_513_3", "S-513", "S-DRAG-SI", "2026-09-25", 0, 13, "gc513");
    expect(collapse([league, againstDragons])).toEqual([league, againstDragons]);
  });

  it("is never a pulled club, which is itself and nobody else", () => {
    const againstOther = row("gc_513_4", "S-513", "S-OTHER", "2026-09-25", 0, 13, "gc513");
    expect(collapse([league, againstOther])).toEqual([league, againstOther]);
  });

  it("is a game of its own when the score is not the league's", () => {
    const another = row("gc_513_5", "S-513", "S-TBD", "2026-09-25", 2, 9, "gc513");
    expect(collapse([league, another])).toEqual([league, another]);
  });

  it("is a game of its own on another day", () => {
    const another = row("gc_513_6", "S-513", "S-TBD", "2026-09-26", 0, 13, "gc513");
    expect(collapse([league, another])).toEqual([league, another]);
  });

  it("leaves an unscored league game alone, which counts for nothing twice", () => {
    const unscored = row("league_default_m7", "S-513", "S-HORN", "2026-09-25");
    expect(collapse([unscored, againstTbd])).toEqual([unscored, againstTbd]);
  });

  it("leaves a day alone when two of the club's league games fit", () => {
    const second = row("league_default_m8", "S-513", "S-OTHER", "2026-09-25", 0, 13);
    expect(collapse([league, second, againstTbd])).toEqual([league, second, againstTbd]);
  });

  it("leaves a day alone when two of the club's rows fit one league game", () => {
    const twin = row("gc_513_7", "S-513", "S-TBD", "2026-09-25", 0, 13, "gc513");
    expect(collapse([league, againstTbd, twin])).toEqual([league, againstTbd, twin]);
  });

  it("leaves a game typed in by hand against TBD alone", () => {
    // Nothing says the club's schedule was never told the opponent: somebody logged a game against
    // "TBD", and it is theirs to say whether it is the league's.
    const typed = row("m_typed_1", "S-513", "S-TBD", "2026-09-25", 0, 13);
    expect(collapse([league, typed])).toEqual([league, typed]);
  });

  it("leaves a row alone that another club's schedule filed", () => {
    // The Hornets' schedule listing a game of 513 Force's against a slot is not 513 Force's copy.
    const notTheirs = row("gc_horn_2", "S-513", "S-TBD", "2026-09-25", 0, 13, "gcHORN");
    expect(collapse([league, notTheirs])).toEqual([league, notTheirs]);
  });

  it("compares only the same two clubs when no roster is given, as before", () => {
    expect(dedupeLeagueFixtures([league, againstTbd])).toEqual([league, againstTbd]);
  });
});
