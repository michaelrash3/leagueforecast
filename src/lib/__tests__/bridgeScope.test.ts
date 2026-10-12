import { describe, expect, it } from "vitest";
import { leagueScoutBridge, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";

const groups: AgeGroup[] = [
  { id: "ag_9_2027", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: ["season-1"] },
];

const team = (id: string, name: string): ScoutTeam => ({ id, name });

const game = (id: string, a: string, b: string, aScore: number, bScore: number): ScoutGame => ({
  id,
  ageGroupId: "ag_9_2027",
  teamAId: a,
  teamBId: b,
  teamAScore: aScore,
  teamBScore: bScore,
  date: "2026-09-12",
});

/**
 * One league team, its opponent, that opponent's opponent, and a club two steps away — plus a
 * stranger with no connection at all. This is the shape a nationwide pull produces: the page the
 * league is linked to holds the whole country.
 */
const pool = () => ({
  teams: [
    team("S-MINE", "My Club"),
    team("S-PLAYED", "Played Us"),
    team("S-THEIRS", "Their Other Opponent"),
    team("S-FAR", "Two Steps Away"),
    team("S-STRANGER", "Never Met Anyone Here"),
    team("S-ALSO", "Also A Stranger"),
  ],
  games: [
    game("g1", "S-MINE", "S-PLAYED", 6, 2),
    game("g2", "S-PLAYED", "S-THEIRS", 3, 1),
    game("g3", "S-THEIRS", "S-FAR", 5, 4),
    game("g4", "S-STRANGER", "S-ALSO", 8, 1),
  ],
});

const leagueTeams = [{ id: "L-MINE", name: "My Club", scoutTeamId: "S-MINE" }];

const bridge = () => {
  const { teams, games } = pool();
  return leagueScoutBridge("season-1", groups, teams, games, leagueTeams, []);
};

describe("what the league's forecast is given", () => {
  it("keeps the league team's own results", () => {
    expect(bridge().results).toContainEqual({
      home: "L-MINE",
      away: "S-S-PLAYED",
      homeMargin: 4,
      date: "2026-09-12",
      neutral: true,
    });
  });

  it("keeps its opponents' other results, which place it on a scale", () => {
    // Beating a club that beat a good club is the evidence an opponent-adjusted rating runs on.
    expect(bridge().results).toContainEqual({
      home: "S-S-PLAYED",
      away: "S-S-THEIRS",
      homeMargin: 2,
      date: "2026-09-12",
      neutral: true,
    });
  });

  it("stops one step out", () => {
    // Their opponent's opponent's game reaches nothing the league can be compared through.
    const homes = bridge().results.map((r) => `${r.home}|${r.away}`);
    expect(homes).not.toContain("S-S-THEIRS|S-S-FAR");
  });

  it("leaves out clubs the league has never touched", () => {
    // The real case: 8,689 clubs on the page a ten-team league was linked to.
    const ids = bridge().results.flatMap((r) => [r.home, r.away]);
    expect(ids).not.toContain("S-S-STRANGER");
    expect(ids).not.toContain("S-S-ALSO");
  });

  it("carries far less than the whole page", () => {
    const { games } = pool();
    // Four games on the page, two of which say something about this league.
    expect(bridge().results).toHaveLength(2);
    expect(games).toHaveLength(4);
  });

  it("counts what it carried, so the panel can say so", () => {
    expect(bridge().countedResults).toBe(2);
  });

  it("carries nothing when no league team is behind any club", () => {
    const { teams, games } = pool();
    const unlinked = [{ id: "L-MINE", name: "Nobody Here" }];
    expect(leagueScoutBridge("season-1", groups, teams, games, unlinked, []).results).toEqual([]);
  });
});
