import { describe, expect, it } from "vitest";
import {
  buildScoutingReport,
  buildTeamRankings,
  deriveLeagueScoutGames,
  isScoutGamePlayed,
  predictMatchup,
  resolveOrCreateTeam,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";
import type { GameLog, Matchup, TeamBase } from "../types";

const team = (id: string, name: string, isMine?: boolean): ScoutTeam => ({
  id,
  name,
  ...(isMine ? { isMine: true } : {}),
});

const game = (
  teamAId: string,
  teamBId: string,
  teamAScore: number | undefined,
  teamBScore: number | undefined,
  seasonId = "s1"
): ScoutGame => ({
  id: `${teamAId}-${teamBId}-${Math.random()}`,
  teamAId,
  teamBId,
  seasonId,
  ...(teamAScore !== undefined ? { teamAScore } : {}),
  ...(teamBScore !== undefined ? { teamBScore } : {}),
});

describe("resolveOrCreateTeam", () => {
  it("matches an existing team case-insensitively and trims whitespace", () => {
    const teams = [team("S-ICEC", "Ice Cats")];
    const result = resolveOrCreateTeam("  ice cats  ", teams);
    expect(result.teamId).toBe("S-ICEC");
    expect(result.teams).toBe(teams);
  });

  it("creates a new team with a prefixed id that cannot collide with a league id", () => {
    const result = resolveOrCreateTeam("Thunder Hawks", []);
    expect(result.teamId.startsWith("S-")).toBe(true);
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0]!.name).toBe("Thunder Hawks");
  });

  it("disambiguates two different names that would otherwise collide", () => {
    const first = resolveOrCreateTeam("Ice Cats", []);
    const second = resolveOrCreateTeam("Ice Castles", first.teams);
    expect(second.teamId).not.toBe(first.teamId);
    expect(second.teams).toHaveLength(2);
  });
});

describe("isScoutGamePlayed", () => {
  it("is true only when both scores are present", () => {
    expect(isScoutGamePlayed(game("A", "B", 5, 3))).toBe(true);
    expect(isScoutGamePlayed(game("A", "B", undefined, undefined))).toBe(false);
  });
});

describe("buildTeamRankings", () => {
  it("ranks a dominant team above a weak one and computes correct W-L-T", () => {
    const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs")];
    const games = [game("A", "B", 10, 2), game("A", "C", 8, 1), game("B", "C", 4, 4)];
    const rows = buildTeamRankings("s1", teams, games);
    const byId = new Map(rows.map((row) => [row.teamId, row]));

    expect(byId.get("A")!.rank).toBe(1);
    expect(byId.get("A")!.record).toBe("2-0");
    expect(byId.get("B")!.record).toBe("0-1-1");
    expect(byId.get("A")!.rating).toBeGreaterThan(byId.get("C")!.rating);
  });

  it("ignores scheduled games with no score yet", () => {
    const teams = [team("A", "Aces"), team("B", "Bears")];
    const games = [game("A", "B", undefined, undefined)];
    const rows = buildTeamRankings("s1", teams, games);
    const byId = new Map(rows.map((row) => [row.teamId, row]));
    expect(byId.get("A")!.games).toBe(0);
    expect(byId.get("A")!.record).toBe("0-0");
  });

  it("only rates games tagged with the requested season", () => {
    const teams = [team("A", "Aces"), team("B", "Bears")];
    const games = [game("A", "B", 10, 0, "s1"), game("A", "B", 0, 10, "s2")];
    const rows = buildTeamRankings("s1", teams, games);
    const a = rows.find((row) => row.teamId === "A")!;
    expect(a.record).toBe("1-0");
  });

  it("never lets isMine influence the rating: swapping it changes nothing but the flag", () => {
    const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs")];
    const games = [game("A", "B", 6, 2), game("B", "C", 5, 3), game("A", "C", 7, 1)];

    const withMine = buildTeamRankings(
      "s1",
      teams.map((t) => (t.id === "B" ? { ...t, isMine: true } : t)),
      games
    );
    const withoutMine = buildTeamRankings("s1", teams, games);

    withMine.forEach((row) => {
      const other = withoutMine.find((r) => r.teamId === row.teamId)!;
      expect(row.rating).toBeCloseTo(other.rating, 10);
      expect(row.rank).toBe(other.rank);
    });
  });
});

describe("deriveLeagueScoutGames", () => {
  const leagueTeams: TeamBase[] = [
    { id: "L1", name: "Ice Cats" },
    { id: "L2", name: "Rockets" },
  ];
  const leagueMatchups: Matchup[] = [
    { id: "g1", date: "5/1", away: "L1", home: "L2" },
    { id: "g2", date: "5/8", away: "L1", home: "L2" },
  ];

  it("only converts completed (final) games, resolving league team names into the scout pool", () => {
    const logs: Record<string, GameLog> = {
      g1: {
        awayRuns: "5",
        awayHits: "8",
        awayK: "4",
        homeRuns: "2",
        homeHits: "3",
        homeK: "6",
        innings: "6",
        isFinal: true,
      },
      g2: {
        awayRuns: "",
        awayHits: "",
        awayK: "",
        homeRuns: "",
        homeHits: "",
        homeK: "",
        innings: "6",
        isFinal: false,
      },
    };

    const result = deriveLeagueScoutGames("s1", leagueTeams, leagueMatchups, logs, []);
    expect(result.games).toHaveLength(1);
    expect(result.teams.map((t) => t.name).sort()).toEqual(["Ice Cats", "Rockets"]);

    const derived = result.games[0]!;
    expect(derived.seasonId).toBe("s1");
    expect(derived.teamAScore).toBe(5);
    expect(derived.teamBScore).toBe(2);
  });

  it("resolves a league team into an existing scout team with the same name instead of duplicating it", () => {
    const existing = [team("S-ICEC", "Ice Cats")];
    const logs: Record<string, GameLog> = {
      g1: {
        awayRuns: "3",
        awayHits: "1",
        awayK: "1",
        homeRuns: "1",
        homeHits: "1",
        homeK: "1",
        innings: "6",
        isFinal: true,
      },
    };
    const result = deriveLeagueScoutGames("s1", leagueTeams, [leagueMatchups[0]!], logs, existing);
    expect(result.teams.filter((t) => t.name === "Ice Cats")).toHaveLength(1);
    expect(result.games[0]!.teamAId).toBe("S-ICEC");
  });
});

describe("predictMatchup", () => {
  it("returns ~50% for equal ratings", () => {
    const { winProbA } = predictMatchup(2, 2);
    expect(winProbA).toBeCloseTo(0.5, 2);
  });

  it("favors the higher-rated team, clamped within [0.08, 0.92]", () => {
    const close = predictMatchup(3, 1);
    expect(close.winProbA).toBeGreaterThan(0.5);
    expect(close.winProbA).toBeLessThanOrEqual(0.92);

    const blowout = predictMatchup(50, -50);
    expect(blowout.winProbA).toBeLessThanOrEqual(0.92);
    expect(blowout.winProbB).toBeCloseTo(0.08, 6);
  });
});

describe("buildScoutingReport", () => {
  it("returns one tiered preview per other team, sorted by opponent rank", () => {
    const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs")];
    const games = [game("A", "B", 10, 1), game("A", "C", 9, 2), game("B", "C", 5, 4)];
    const rows = buildTeamRankings("s1", teams, games);

    const report = buildScoutingReport("C", rows);
    expect(report).toHaveLength(2);
    expect(report.map((r) => r.opponentId)).toEqual(["A", "B"]);
    expect(report.every((r) => ["Favored", "Toss-up", "Underdog"].includes(r.tier))).toBe(true);
  });

  it("returns an empty list for an unknown team id", () => {
    expect(buildScoutingReport("nope", [])).toEqual([]);
  });
});
