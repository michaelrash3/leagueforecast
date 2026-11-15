import { describe, expect, it } from "vitest";
import { buildBracketProjection } from "../bracket";
import { buildDemoSeason } from "../demoSeason";
import { calculateTeams, rankOptionsFromSettings, rankTeams } from "../sim";
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

  it("sends the model's favourite on from a close game, the better seed or not", () => {
    // The game the bracket once gave to the underdog: seed 1 a narrow favourite over seed 4.
    const projection = buildBracketProjection({
      teams: [team("C", 1, 0.2, 6), team("B", 2, 4, 6), team("A", 3, 3, 6), team("D", 4, 0, 6)],
      cutoff: 4,
      logs: {},
      settings: DEFAULT_SETTINGS,
    });

    const closeGame = projection.rounds[0]?.[0];

    expect(closeGame?.prediction?.winnerId).toBe("C");
    expect(closeGame?.predictedWinnerId).toBe("C");
    expect(closeGame?.winnerId).toBe("C");
    expect(closeGame?.winnerSource).toBe("projected");
  });

  it("picks no team the model gives the worse chance, on the demo season at every stage", () => {
    const { teams, matchups, logs, settings } = buildDemoSeason();
    const finals = matchups.filter((game) => logs[game.id]?.isFinal);
    let projected = 0;
    for (let played = 0; played <= finals.length; played += 1) {
      const kept: Record<string, GameLog> = {};
      for (const game of finals.slice(0, played)) {
        const log = logs[game.id];
        if (log) kept[game.id] = log;
      }
      const ranked = rankTeams(
        calculateTeams(teams, matchups, kept, settings),
        rankOptionsFromSettings(settings)
      );
      for (let cutoff = 2; cutoff <= teams.length; cutoff += 1) {
        const brackets = [
          buildBracketProjection({ teams: ranked, cutoff, logs: {}, settings }),
          buildBracketProjection({
            teams: ranked,
            cutoff: teams.length - cutoff,
            startIndex: cutoff,
            idPrefix: "silver-bracket",
            logs: {},
            settings,
          }),
        ];
        for (const game of brackets.flatMap((bracket) => bracket.rounds.flat())) {
          if (game.winnerSource !== "projected" || !game.prediction) continue;
          projected += 1;
          // The top slot is the game's home side; level, it goes on.
          const topChance = 1 - game.prediction.awayWinPct;
          const favourite = topChance >= 0.5 ? game.top.team?.id : game.bottom.team?.id;
          expect(game.predictedWinnerId, `${played} played, cutoff ${cutoff}, ${game.id}`).toBe(
            favourite
          );
        }
      }
    }
    // Enough games that the check is not vacuous; the same seasons held 159 underdog picks before.
    expect(projected).toBeGreaterThan(700);
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
