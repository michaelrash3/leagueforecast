import { describe, expect, it } from "vitest";
import { looseNameKey, standInReport } from "../standInReport";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * The stand-ins of a squad year (`standInReport`): the clubs known only by name, the slots, the
 * games that lean on them, and which of the named ones share a name with a pulled club.
 */

const groups = [
  { id: "ag_10u_2027", name: "10U 2027", year: 2027 },
  { id: "ag_11u_2027", name: "11U 2027", year: 2027 },
  { id: "ag_10u_2026", name: "10U 2026", year: 2026 },
] as AgeGroup[];
const teams: ScoutTeam[] = [
  { id: "S-A", name: "Aces" },
  { id: "S-B", name: "Bears" },
  { id: "N-B", name: "Bears", nameOnly: true },
  { id: "N-Z", name: "Zebras", nameOnly: true },
  { id: "P-1", name: "Winner of Game 3", placeholder: true },
  // A pulled Cubs at 11U only, and a Cubs known only by name at 10U.
  { id: "S-C", name: "Cubs" },
  { id: "S-D", name: "Dogs" },
  { id: "N-C", name: "Cubs", nameOnly: true },
];
const game = (id: string, a: string, b: string, played = true, page = "ag_10u_2027") =>
  ({
    id,
    ageGroupId: page,
    teamAId: a,
    teamBId: b,
    ...(played ? { teamAScore: 5, teamBScore: 3 } : {}),
  }) as ScoutGame;

describe("the stand-ins of a squad year", () => {
  const report = standInReport(
    teams,
    [
      game("g1", "S-A", "S-B"),
      game("g2", "S-A", "N-B"),
      game("g3", "S-B", "N-Z"),
      game("g4", "S-A", "N-Z", false),
      game("g5", "S-B", "P-1"),
      game("g8", "S-A", "P-1", false),
      game("g6", "S-A", "N-C"),
      game("g7", "S-C", "S-D", true, "ag_11u_2027"),
      // Another year's: in none of the counts.
      game("o1", "S-A", "N-Z", true, "ag_10u_2026"),
    ],
    groups,
    2027
  );

  it("counts the year's games that lean on a stand-in, played and all", () => {
    expect(report).toMatchObject({
      games: 8,
      withStandIn: 6,
      played: 6,
      playedWithStandIn: 4,
      nameOnly: 3,
      placeholders: 1,
      slotPlayed: 1,
    });
  });

  it("says which clubs known only by name share a name with a pulled club, and where", () => {
    expect(report.withNamesake).toBe(2);
    expect(report.withoutNamesake).toBe(1);
    // A namesake on a page the stand-in played on (the Bears), only on another page (the Cubs, a
    // pulled 11U against a 10U stand-in), or nowhere (the Zebras): clubs, their games, played.
    expect(report.onPage).toEqual({ clubs: 1, games: 1, played: 1 });
    expect(report.elsewhere).toEqual({ clubs: 1, games: 1, played: 1 });
    expect(report.unmatched).toEqual({ clubs: 1, games: 2, played: 1 });
    // Most games first: the Zebras hold two, one still to play.
    expect(report.top).toEqual([
      {
        teamId: "N-Z",
        name: "Zebras",
        why: "unmatched",
        games: 2,
        played: 1,
        namesakes: 0,
        namesakesOnPage: 0,
      },
      {
        teamId: "N-B",
        name: "Bears",
        why: "oneSameState",
        candidate: { teamId: "S-B", name: "Bears" },
        games: 1,
        played: 1,
        namesakes: 1,
        namesakesOnPage: 1,
      },
      {
        teamId: "N-C",
        name: "Cubs",
        why: "elsewhere",
        games: 1,
        played: 1,
        namesakes: 1,
        namesakesOnPage: 0,
      },
    ]);
  });
});

describe("why each club known only by name was not joined to a pulled club", () => {
  const ten = "ag_10u_2027";
  const pulled = (id: string, name: string, state?: string): ScoutTeam => ({
    id,
    name,
    ...(state ? { state } : {}),
  });
  const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });
  const why = standInReport(
    [
      pulled("S-A", "Aces", "KY"),
      pulled("S-B", "Bears"),
      pulled("S-E", "Eagles", "OH"),
      pulled("S-H1", "Hawks", "KY"),
      pulled("S-H2", "Hawks", "KY"),
      pulled("S-R", "Rocky Top Raiders Baseball", "KY"),
      pulled("S-C", "Cubs", "KY"),
      pulled("S-D", "Dogs", "KY"),
      standIn("N-B", "Bears"),
      standIn("N-E", "Eagles"),
      standIn("N-H", "Hawks"),
      standIn("N-R", "Rocky Top Raiders"),
      standIn("N-C", "Cubs"),
      standIn("N-Z", "Zebras"),
    ],
    [
      // The pulled namesakes on the 10U page, each against the Aces.
      game("p1", "S-A", "S-B", true, ten),
      game("p2", "S-A", "S-E", true, ten),
      game("p3", "S-A", "S-H1", true, ten),
      game("p4", "S-A", "S-H2", true, ten),
      game("p5", "S-A", "S-R", true, ten),
      // The pulled Cubs at 11U only.
      game("p6", "S-C", "S-D", true, "ag_11u_2027"),
      // The Aces (Kentucky) against each name their schedule wrote down.
      ...["N-B", "N-E", "N-H", "N-R", "N-C", "N-Z"].map((id) =>
        game(`s-${id}`, "S-A", id, true, ten)
      ),
    ],
    groups,
    2027
  );
  const one = { clubs: 1, games: 1, played: 1 };

  it("sorts them by what the import would have needed", () => {
    expect(why.why).toEqual({
      // One pulled club of the name on its page, where the clubs naming it are: the import's own
      // rule joins this, so a stand-in here is one it failed to join.
      oneSameState: one,
      // One, in another state than the clubs naming it.
      oneOtherState: one,
      // Several of the name on its page.
      several: one,
      // None of the name on its page, but one spelled near it (`looseNameKey`).
      nearOne: one,
      nearSeveral: { clubs: 0, games: 0, played: 0 },
      // A namesake only on another page, and none at all.
      elsewhere: one,
      unmatched: one,
    });
  });

  it("names the club each would have been joined to", () => {
    const pairs = (key: keyof typeof why.topWhy) =>
      why.topWhy[key].map((club) => [club.teamId, club.candidate?.teamId]);
    expect(pairs("oneSameState")).toEqual([["N-B", "S-B"]]);
    expect(pairs("oneOtherState")).toEqual([["N-E", "S-E"]]);
    expect(pairs("nearOne")).toEqual([["N-R", "S-R"]]);
    expect(pairs("several")).toEqual([["N-H", undefined]]);
  });

  it("reads a name loosely: filler words, full stops and spacing aside", () => {
    expect(looseNameKey("Rocky Top Raiders Baseball")).toBe(looseNameKey("Rocky Top Raiders"));
    expect(looseNameKey("St. Louis Bears - Floyd")).toBe(looseNameKey("STL Bears Floyd"));
    expect(looseNameKey("The Hit Squad BC")).toBe(looseNameKey("Hit Squad"));
    expect(looseNameKey("KC Crushers Black")).not.toBe(looseNameKey("KC Crushers"));
  });
});
