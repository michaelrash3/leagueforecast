import { describe, expect, it } from "vitest";
import { standInReport } from "../standInReport";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * The stand-ins of a squad year (`standInReport`): the clubs known only by name, the slots, the
 * games that lean on them, and which of the named ones share a name with a pulled club.
 */

const groups = [
  { id: "ag_10u_2027", name: "10U 2027", year: 2027 },
  { id: "ag_10u_2026", name: "10U 2026", year: 2026 },
] as AgeGroup[];
const teams: ScoutTeam[] = [
  { id: "S-A", name: "Aces" },
  { id: "S-B", name: "Bears" },
  { id: "N-B", name: "Bears", nameOnly: true },
  { id: "N-Z", name: "Zebras", nameOnly: true },
  { id: "P-1", name: "Winner of Game 3", placeholder: true },
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
      // Another year's: in none of the counts.
      game("o1", "S-A", "N-Z", true, "ag_10u_2026"),
    ],
    groups,
    2027
  );

  it("counts the year's games that lean on a stand-in, played and all", () => {
    expect(report).toMatchObject({
      games: 5,
      withStandIn: 4,
      played: 4,
      playedWithStandIn: 3,
      nameOnly: 2,
      placeholders: 1,
    });
  });

  it("says which clubs known only by name share a name with a pulled club", () => {
    expect(report.withNamesake).toBe(1);
    expect(report.withoutNamesake).toBe(1);
    // Most games first: the Zebras hold two, one still to play.
    expect(report.top).toEqual([
      { teamId: "N-Z", name: "Zebras", games: 2, played: 1, namesakes: 0 },
      { teamId: "N-B", name: "Bears", games: 1, played: 1, namesakes: 1 },
    ]);
  });
});
