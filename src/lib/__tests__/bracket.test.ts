import { describe, expect, it } from "vitest";
import { buildBracketProjection } from "../bracket";
import { DEFAULT_SETTINGS, type GameLog, type Team } from "../types";

const team = (id: string, rank: number, tpi: number, games = 0): Team => ({
  id,
  name: id,
  w: 0,
  l: 0,
  t: 0,
  rs: games * 7,
  ra: games * 7,
  games,
  pct: 0.5,
  runDiff: 0,
  rsg: 7,
  rag: 7,
  hpg: 9,
  kpg: 4,
  oppKpg: 0,
  tpi,
  baseTpi: tpi,
  sos: 0,
  momentum: 0,
  awayK6: null,
  homeK6: null,
  totalK6: null,
  machineDifficulty: 0,
  headToHead: {},
  rank,
});

const final = (awayRuns: string, homeRuns: string): GameLog => ({
  awayRuns,
  homeRuns,
  awayHits: "0",
  homeHits: "0",
  awayK: "0",
  homeK: "0",
  innings: "6",
  isFinal: true,
});

describe("buildBracketProjection", () => {
  it("builds a seeded power-of-two bracket with byes", () => {
    const projection = buildBracketProjection({
      teams: [team("A", 1, 5), team("B", 2, 4), team("C", 3, 3)],
      cutoff: 3,
      logs: {},
      settings: DEFAULT_SETTINGS,
    });

    expect(projection.size).toBe(4);
    expect(projection.rounds).toHaveLength(2);
    expect(projection.rounds[0]).toHaveLength(2);
    expect(projection.rounds[0]?.[0]?.top.team?.id).toBe("A");
    expect(projection.rounds[0]?.[0]?.bottom.team).toBeNull();
  });

  it("uses actual final scores to advance winners over model picks", () => {
    const projection = buildBracketProjection({
      teams: [team("A", 1, 8), team("B", 2, 7), team("C", 3, 1), team("D", 4, 0)],
      cutoff: 4,
      logs: {
        "bracket-r1-g1": final("9", "3"),
        "bracket-r1-g2": final("2", "8"),
        "bracket-r2-g1": final("10", "4"),
      },
      settings: DEFAULT_SETTINGS,
    });

    expect(projection.rounds[0]?.[0]?.winnerId).toBe("D");
    expect(projection.rounds[0]?.[0]?.winnerSource).toBe("actual");
    expect(projection.champion?.id).toBe("B");
    expect(projection.championSource).toBe("actual");
  });

  it("allows deterministic lower-seed bracket picks in close projected games", () => {
    const projection = buildBracketProjection({
      teams: [team("C", 1, 0.2, 6), team("B", 2, 4, 6), team("A", 3, 3, 6), team("D", 4, 0, 6)],
      cutoff: 4,
      logs: {},
      settings: DEFAULT_SETTINGS,
    });

    const closeGame = projection.rounds[0]?.[0];

    expect(closeGame?.prediction?.winnerId).toBe("C");
    expect(closeGame?.predictedWinnerId).toBe("D");
    expect(closeGame?.winnerId).toBe("D");
  });

  it("can build a Silver-style bracket from teams below the Gold cutoff", () => {
    const projection = buildBracketProjection({
      teams: [
        team("G1", 1, 9),
        team("G2", 2, 8),
        team("S1", 3, 7),
        team("S2", 4, 6),
        team("S3", 5, 5),
      ],
      cutoff: 3,
      startIndex: 2,
      idPrefix: "silver-bracket",
      logs: {
        "silver-bracket-r1-g1": final("5", "6"),
      },
      settings: DEFAULT_SETTINGS,
    });

    expect(projection.entrantCount).toBe(3);
    expect(projection.rounds[0]?.[0]?.id).toBe("silver-bracket-r1-g1");
    expect(projection.rounds[0]?.[0]?.top.team?.id).toBe("S1");
    expect(projection.rounds[0]?.[0]?.winnerId).toBe("S1");
  });
});
