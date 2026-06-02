import { describe, expect, it } from "vitest";
import {
  clinchingPathForTeam,
  clinchingPathsForTeams,
  goldCutLineSnapshot,
} from "../clinchingPaths";
import { rankTeams } from "../sim";
import { DEFAULT_SETTINGS, type Matchup, type SwingGame, type TeamWithProjection } from "../types";

const team = (
  overrides: Partial<TeamWithProjection> & { id: string; name?: string }
): TeamWithProjection => ({
  name: overrides.name ?? overrides.id,
  w: 0,
  l: 0,
  t: 0,
  rs: 0,
  ra: 0,
  games: 0,
  pct: 0,
  runDiff: 0,
  rsg: 0,
  rag: 0,
  hpg: 0,
  kpg: 0,
  tpi: 0,
  baseTpi: 0,
  sos: 0,
  momentum: 0,
  awayK6: null,
  homeK6: null,
  totalK6: null,
  machineDifficulty: 0,
  projectedRank: overrides.projectedRank ?? overrides.rank ?? 99,
  projectedRecord: "0-0",
  projectedRunDiff: 0,
  goldPct: overrides.goldPct ?? 50,
  goldTrend: [],
  goldStatus: overrides.goldStatus ?? "Alive",
  maxPoints: overrides.maxPoints ?? 2,
  blockersAhead: overrides.blockersAhead ?? 0,
  ...overrides,
  id: overrides.id,
});

const swing = (overrides: Partial<SwingGame>): SwingGame => ({
  game: { id: "g1", date: "5/1", away: "A", home: "B" },
  opponentName: "Bears",
  teamIsAway: false,
  winSeed: 2,
  lossSeed: 4,
  modelPick: "Aces",
  winPct: 0.56,
  ...overrides,
});

const settings = { ...DEFAULT_SETTINGS, goldCutoff: 2 };

describe("clinchingPathForTeam", () => {
  it("summarizes clinched and eliminated teams plainly", () => {
    expect(
      clinchingPathForTeam({
        team: team({ id: "A", name: "Aces", rank: 1, goldStatus: "Clinched" }),
        teams: [],
        remaining: [],
        cutoff: 2,
        settings,
        swings: [],
      }).notes[0]
    ).toContain("clinched");

    expect(
      clinchingPathForTeam({
        team: team({ id: "D", name: "Ducks", rank: 4, goldStatus: "Eliminated" }),
        teams: [],
        remaining: [],
        cutoff: 2,
        settings,
        swings: [],
      }).notes[0]
    ).toContain("Eliminated");
  });

  it("highlights bubble swing games in Gold path language", () => {
    const note = clinchingPathForTeam({
      team: team({ id: "A", name: "Aces", rank: 3, projectedRank: 3, goldPct: 44 }),
      teams: [team({ id: "A", rank: 3 }), team({ id: "B", rank: 2 }), team({ id: "C", rank: 1 })],
      remaining: [{ id: "g1", date: "5/1", away: "A", home: "B" }],
      cutoff: 2,
      settings,
      swings: [swing({ winSeed: 2, lossSeed: 4 })],
      exactLimit: 0,
    });

    expect(note.notes.join(" ")).toContain("win projects inside Gold");
    expect(note.priority).toBeGreaterThan(0);
  });

  it("points outside bubble teams toward help from nearby rivals", () => {
    const teams = rankTeams(
      [
        team({ id: "A", name: "Aces", w: 0, rank: 3, projectedRank: 3 }),
        team({ id: "B", name: "Bears", w: 1, rank: 2, projectedRank: 2 }),
        team({ id: "C", name: "Comets", w: 2, rank: 1, projectedRank: 1 }),
        team({ id: "D", name: "Ducks", w: 0, rank: 4, projectedRank: 4 }),
      ],
      { runDiffTiebreaker: false, tiebreakerOrder: [] }
    ) as TeamWithProjection[];
    const remaining: Matchup[] = [{ id: "g2", date: "5/2", away: "B", home: "D" }];

    const note = clinchingPathForTeam({
      team: teams.find((item) => item.id === "A")!,
      teams,
      remaining,
      cutoff: 2,
      settings,
      swings: [],
      exactLimit: 0,
    });

    expect(note.notes.join(" ")).toContain("get help if");
  });
});

describe("clinchingPathsForTeams", () => {
  it("prioritizes teams near the Gold cut line", () => {
    const teams = [
      team({ id: "A", rank: 1, projectedRank: 1, goldPct: 99, goldStatus: "In" }),
      team({ id: "B", rank: 2, projectedRank: 3, goldPct: 52, goldStatus: "In" }),
      team({ id: "C", rank: 4, projectedRank: 4, goldPct: 2, goldStatus: "Alive" }),
    ];
    const paths = clinchingPathsForTeams(teams, [], 2, settings, () => [], {
      limit: 1,
      exactLimit: 0,
    });
    expect(paths[0]?.teamId).toBe("B");
  });
});

describe("goldCutLineSnapshot", () => {
  it("returns last in, first out, and points gap", () => {
    const snapshot = goldCutLineSnapshot(
      [
        team({ id: "A", name: "Aces", w: 2, rank: 1 }),
        team({ id: "B", name: "Bears", w: 1, rank: 2 }),
        team({ id: "C", name: "Comets", w: 0, rank: 3 }),
      ],
      2,
      settings
    );
    expect(snapshot.lastInName).toBe("Bears");
    expect(snapshot.firstOutName).toBe("Comets");
    expect(snapshot.pointsGap).toBe(1);
  });
});
