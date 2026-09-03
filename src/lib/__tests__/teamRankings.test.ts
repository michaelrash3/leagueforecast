import { describe, expect, it } from "vitest";
import {
  buildScoutingReport,
  buildTeamRankings,
  deriveLeagueScoutGames,
  isScoutGamePlayed,
  predictMatchup,
  resolveOrCreateTeam,
  type LeagueSeasonSnapshot,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

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
  ageGroupId = "ag1"
): ScoutGame => ({
  id: `${teamAId}-${teamBId}-${Math.random()}`,
  teamAId,
  teamBId,
  ageGroupId,
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
    const rows = buildTeamRankings("ag1", teams, games);
    const byId = new Map(rows.map((row) => [row.teamId, row]));

    expect(byId.get("A")!.rank).toBe(1);
    expect(byId.get("A")!.record).toBe("2-0");
    expect(byId.get("B")!.record).toBe("0-1-1");
    expect(byId.get("A")!.rating).toBeGreaterThan(byId.get("C")!.rating);
  });

  it("ignores scheduled games with no score yet", () => {
    const teams = [team("A", "Aces"), team("B", "Bears")];
    const games = [game("A", "B", undefined, undefined)];
    const rows = buildTeamRankings("ag1", teams, games);
    const byId = new Map(rows.map((row) => [row.teamId, row]));
    expect(byId.get("A")!.games).toBe(0);
    expect(byId.get("A")!.record).toBe("0-0");
  });

  it("only rates games tagged with the requested age group", () => {
    const teams = [team("A", "Aces"), team("B", "Bears")];
    const games = [game("A", "B", 10, 0, "ag1"), game("A", "B", 0, 10, "ag2")];
    const rows = buildTeamRankings("ag1", teams, games);
    const a = rows.find((row) => row.teamId === "A")!;
    expect(a.record).toBe("1-0");
  });

  it("never lets isMine influence the rating: swapping it changes nothing but the flag", () => {
    const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs")];
    const games = [game("A", "B", 6, 2), game("B", "C", 5, 3), game("A", "C", 7, 1)];

    const withMine = buildTeamRankings(
      "ag1",
      teams.map((t) => (t.id === "B" ? { ...t, isMine: true } : t)),
      games
    );
    const withoutMine = buildTeamRankings("ag1", teams, games);

    withMine.forEach((row) => {
      const other = withoutMine.find((r) => r.teamId === row.teamId)!;
      expect(row.rating).toBeCloseTo(other.rating, 10);
      expect(row.rank).toBe(other.rank);
    });
  });
});

describe("deriveLeagueScoutGames", () => {
  const fallSeason: LeagueSeasonSnapshot = {
    seasonId: "fall2026",
    teams: [
      { id: "L1", name: "Ice Cats" },
      { id: "L2", name: "Rockets" },
    ],
    matchups: [{ id: "g1", date: "10/1", away: "L1", home: "L2" }],
    logs: {
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
    },
  };
  const springSeason: LeagueSeasonSnapshot = {
    seasonId: "spring2027",
    // Same real-world teams, but a fresh per-season id namespace (as League Standings actually
    // generates them) — resolution must go by name, not by these ids.
    teams: [
      { id: "X1", name: "Ice Cats" },
      { id: "X2", name: "Comets" },
    ],
    matchups: [{ id: "g2", date: "4/1", away: "X1", home: "X2" }],
    logs: {
      g2: {
        awayRuns: "4",
        awayHits: "5",
        awayK: "3",
        homeRuns: "6",
        homeHits: "7",
        homeK: "2",
        innings: "6",
        isFinal: true,
      },
    },
  };

  it("only converts completed (final) games, resolving league team names into the scout pool", () => {
    const unfinished: LeagueSeasonSnapshot = {
      seasonId: "fall2026",
      teams: fallSeason.teams,
      matchups: [{ id: "g3", date: "10/8", away: "L1", home: "L2" }],
      logs: {
        g3: {
          awayRuns: "",
          awayHits: "",
          awayK: "",
          homeRuns: "",
          homeHits: "",
          homeK: "",
          innings: "6",
          isFinal: false,
        },
      },
    };

    const result = deriveLeagueScoutGames("ag1", [fallSeason, unfinished], []);
    expect(result.games).toHaveLength(1);
    expect(result.teams.map((t) => t.name).sort()).toEqual(["Ice Cats", "Rockets"]);

    const derived = result.games[0]!;
    expect(derived.ageGroupId).toBe("ag1");
    expect(derived.teamAScore).toBe(5);
    expect(derived.teamBScore).toBe(2);
  });

  it("merges multiple seasons in the same age group and resolves the same team name to one id across them", () => {
    const result = deriveLeagueScoutGames("ag1", [fallSeason, springSeason], []);
    expect(result.games).toHaveLength(2);
    // "Ice Cats" appears in both seasons under different League Standings ids — resolved once.
    const iceCats = result.teams.filter((t) => t.name === "Ice Cats");
    expect(iceCats).toHaveLength(1);
    const iceCatsGames = result.games.filter(
      (g) => g.teamAId === iceCats[0]!.id || g.teamBId === iceCats[0]!.id
    );
    expect(iceCatsGames).toHaveLength(2);
  });

  it("resolves a league team into an existing scout team with the same name instead of duplicating it", () => {
    const existing = [team("S-ICEC", "Ice Cats")];
    const result = deriveLeagueScoutGames("ag1", [fallSeason], existing);
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
    const rows = buildTeamRankings("ag1", teams, games);

    const report = buildScoutingReport("C", rows);
    expect(report).toHaveLength(2);
    expect(report.map((r) => r.opponentId)).toEqual(["A", "B"]);
    expect(report.every((r) => ["Favored", "Toss-up", "Underdog"].includes(r.tier))).toBe(true);
  });

  it("returns an empty list for an unknown team id", () => {
    expect(buildScoutingReport("nope", [])).toEqual([]);
  });
});
