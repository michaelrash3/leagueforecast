import { describe, expect, it } from "vitest";
import { explainForecast } from "../forecastExplanation";
import { buildPredictionEngine, type ExternalResult } from "../predictionEngine";
import { calculateTeams } from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

/*
 * Forecast explanations (2.8): the Dashboard's matchup odds told as the sum of their parts, and the
 * context around them. Placeholder teams.
 */

const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: "6",
  homeHits: "5",
  awayK: "4",
  homeK: "5",
  innings: "6",
  isFinal: true,
});

const teams: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
  { id: "D", name: "Ducks" },
  { id: "E", name: "Eagles" },
];

const matchups: Matchup[] = [
  { id: "g1", date: "5/2", away: "A", home: "B" },
  { id: "g2", date: "5/2", away: "C", home: "D" },
  { id: "g3", date: "5/9", away: "A", home: "C" },
  { id: "g4", date: "5/9", away: "B", home: "E" },
  { id: "g5", date: "5/16", away: "D", home: "A" },
  { id: "g6", date: "5/16", away: "E", home: "C" },
  { id: "g7", date: "5/23", away: "B", home: "A" },
  // Still to play.
  { id: "g8", date: "5/30", away: "A", home: "E" },
  { id: "g9", date: "5/30", away: "B", home: "D" },
  { id: "g10", date: "6/6", away: "C", home: "B" },
  { id: "g11", date: "6/6", away: "E", home: "D" },
];

const logs: Record<string, GameLog> = {
  g1: final(7, 3),
  g2: final(4, 5),
  g3: final(9, 2),
  g4: final(3, 6),
  g5: final(1, 8),
  g6: final(5, 5),
  g7: final(6, 4),
};

// Two of the league's teams have tournament results besides, one against an outside club twice.
const external: ExternalResult[] = [
  { away: "E", home: "X1", homeMargin: -6, date: "2026-04-18", neutral: true },
  { away: "X1", home: "D", homeMargin: 2, date: "2026-04-19", neutral: true },
  { away: "E", home: "X2", homeMargin: 1, date: "2026-04-25", neutral: true },
];

const engineFor = (
  games: Matchup[] = matchups,
  scores: Record<string, GameLog> = logs,
  outside: ExternalResult[] = external
) =>
  buildPredictionEngine(
    calculateTeams(teams, games, scores, DEFAULT_SETTINGS),
    games,
    scores,
    DEFAULT_SETTINGS,
    outside
  );

describe("the matchup odds", () => {
  it("are pinned, so explaining them moves none of them", () => {
    const pinned = engineFor().predictions.map((prediction) => ({
      gameId: prediction.gameId,
      predictedWinnerId: prediction.predictedWinnerId,
      projectedMargin: prediction.projectedMargin,
      winProbability: prediction.winProbability,
      expectedScore: prediction.expectedScore,
      confidence: prediction.confidence,
      keyFactors: prediction.keyFactors,
      riskFactors: prediction.riskFactors,
    }));
    expect(pinned).toMatchSnapshot();
  });
});

const explanationOf = (engine: ReturnType<typeof engineFor>, gameId: string) => {
  const prediction = engine.predictions.find((one) => one.gameId === gameId);
  if (!prediction) throw new Error(`No forecast for ${gameId}`);
  return prediction;
};

const nameOf = (id: string) => teams.find((team) => team.id === id)?.name ?? id;

describe("the margin's parts", () => {
  it("add up to the margin the win chance is read from", () => {
    const engine = engineFor();
    expect(engine.predictions.length).toBeGreaterThan(0);
    for (const prediction of engine.predictions) {
      const explanation = prediction.explanation;
      if (!explanation) throw new Error(`No explanation for ${prediction.gameId}`);
      const sum = Object.values(explanation.parts).reduce((total, value) => total + value, 0);
      expect(sum).toBeCloseTo(explanation.margin, 10);
      expect(Math.abs(Number(explanation.margin.toFixed(1)))).toBe(prediction.projectedMargin);
      expect(prediction.predictedWinnerId).toBe(
        explanation.margin >= 0 ? prediction.teamAId : prediction.teamBId
      );
    }
  });

  it("split each rating into its own results and its opponents' share, as the fit does", () => {
    const { explanation } = explanationOf(engineFor(), "g8");
    if (!explanation) throw new Error("No explanation");
    const { teamA, teamB, parts } = explanation;
    const share = (side: typeof teamA, of: number) =>
      (side.fittedGames * of) / (side.fittedGames + 1.5);
    expect(parts.results).toBeCloseTo(
      share(teamA, teamA.rawMargin) - share(teamB, teamB.rawMargin),
      10
    );
    // Every game here is neutral and counts once, so the rest of each rating is exactly the
    // opponents' share of it.
    expect(parts.schedule).toBeCloseTo(
      share(teamA, teamA.strengthOfSchedule) - share(teamB, teamB.strengthOfSchedule),
      10
    );
    expect(parts.homeField).toBe(-0);
    expect(parts.capped).toBe(0);
  });
});

describe("explainForecast", () => {
  it("leans each factor toward the side it favors, the strongest for each side first", () => {
    const prediction = explanationOf(engineFor(), "g8");
    const explained = explainForecast(prediction, { nameOf });
    if (!explained || !prediction.explanation) throw new Error("No explanation");
    const { parts } = prediction.explanation;
    const results = explained.factors.find((factor) => factor.key === "results");
    expect(results?.favors).toBe(parts.results > 0 ? "teamA" : "teamB");
    expect(results?.runs).toBeCloseTo(Math.abs(parts.results), 10);
    const inMargin = explained.factors.filter((factor) => factor.inMargin);
    expect(inMargin.map((factor) => factor.runs ?? 0)).toEqual(
      [...inMargin.map((factor) => factor.runs ?? 0)].sort((one, two) => two - one)
    );
    expect(explained.favorite).toBe("teamA");
    expect(explained.strongest.teamA?.favors).toBe("teamA");
    expect(explained.strongest.teamB?.favors ?? "teamB").toBe("teamB");
    expect(explained).toMatchSnapshot();
  });

  it("reads the same game the same way with the sides swapped", () => {
    // Aces at Eagles, and Eagles at Aces, both still to play: one game seen from either side.
    const games: Matchup[] = [...matchups, { id: "g12", date: "5/30", away: "E", home: "A" }];
    const engine = engineFor(games);
    const one = explainForecast(explanationOf(engine, "g8"), { nameOf });
    const other = explainForecast(explanationOf(engine, "g12"), { nameOf });
    if (!one || !other) throw new Error("No explanation");
    expect(other.margin).toBeCloseTo(-one.margin, 10);
    expect(other.chance).toEqual({ teamA: one.chance.teamB, teamB: one.chance.teamA });
    expect(other.favorite).toBe("teamB");
    const flip = (side: "teamA" | "teamB" | null) =>
      side === "teamA" ? "teamB" : side === "teamB" ? "teamA" : null;
    expect(other.factors.map((factor) => [factor.key, factor.favors, factor.runs])).toEqual(
      one.factors.map((factor) => [factor.key, flip(factor.favors), factor.runs])
    );
    expect(other.strongest.teamB?.key).toBe(one.strongest.teamA?.key);
  });

  it("explains nothing it has no scores for", () => {
    const blank = engineFor(matchups, {}, []);
    expect(blank.predictions.every((prediction) => prediction.explanation === undefined)).toBe(
      true
    );
    const first = blank.predictions[0];
    if (!first) throw new Error("No forecast");
    expect(explainForecast(first, { nameOf })).toBeNull();
  });

  it("counts a side with few games for less, and says so", () => {
    // The same results, one game fewer for the Eagles: their part shrinks toward average.
    const fewer = { ...logs };
    delete fewer.g6;
    const full = explanationOf(engineFor(), "g8").explanation;
    const thin = explanationOf(engineFor(matchups, fewer, []), "g8");
    if (!full || !thin.explanation) throw new Error("No explanation");
    expect(thin.explanation.teamB.fittedGames).toBe(1);
    const explained = explainForecast(thin, { nameOf });
    expect(explained?.sensitivities).toContain(
      "Eagles has one game the rating can use, so one more result could move this a long way."
    );
    expect(full.teamB.fittedGames).toBeGreaterThan(thin.explanation.teamB.fittedGames);
  });

  it("says when the other model disagrees, a link is a guess, or a side has not played lately", () => {
    const prediction = explanationOf(engineFor(), "g11");
    const explained = explainForecast(prediction, {
      nameOf,
      gameModelChance: 1 - prediction.winProbability.teamA,
      ambiguous: new Set(["E"]),
    });
    if (!explained) throw new Error("No explanation");
    expect(explained.sensitivities.join(" ")).toMatch(
      /The Schedule's game odds give Eagles \d+%, against \d+% here/
    );
    expect(explained.sensitivities).toContain(
      "Eagles's Team Rankings results come from a club picked by name, and more than one club carries it: they may be another club's."
    );
    const gameModel = explained.factors.find((factor) => factor.key === "gameModel");
    expect(gameModel?.favors).toBe(explained.favorite === "teamA" ? "teamB" : "teamA");

    // Backing the same side, they disagree only once 15 points apart.
    const disagree = (gameModelChance: number) =>
      explainForecast(prediction, { nameOf, gameModelChance })?.sensitivities.some((line) =>
        line.startsWith("The Schedule's game odds")
      );
    const shown = prediction.winProbability.teamA;
    const away = shown >= 0.5 ? 1 : -1;
    expect(disagree(shown + away * 0.2)).toBe(true);
    expect(disagree(shown + away * 0.05)).toBe(false);

    // A month off: the Ducks' newest result is long before their game.
    const late: Matchup[] = matchups.map((game) =>
      game.id === "g11" ? { ...game, date: "7/18" } : game
    );
    const stale = explainForecast(explanationOf(engineFor(late), "g11"), { nameOf });
    expect(stale?.sensitivities.join(" ")).toMatch(/Ducks's newest result is \d+ days before/);
  });

  it("writes a Team Rankings result's day the way the league's are written", () => {
    // The Eagles' league games unplayed: their newest result is a tournament game, an ISO day.
    const { g4: _g4, g6: _g6, ...withoutEagles } = logs;
    const explained = explainForecast(explanationOf(engineFor(matchups, withoutEagles), "g8"), {
      nameOf,
    });
    const freshness = explained?.factors.find((factor) => factor.key === "freshness");
    expect(freshness?.text).toContain("Eagles: 4/25, 35 days before this game.");
    expect(explained?.sensitivities).toContain(
      "Eagles's newest result is 35 days before this game, so it may not show how they play now."
    );
  });

  it("takes off what the cap on a margin does, and holds the chance at 92%", () => {
    // Three teams, two of them routed by 25 runs: the Aces beat the Comets twice and lead by more
    // than a projected margin may.
    const three = teams.slice(0, 3);
    const games: Matchup[] = [
      { id: "b1", date: "5/2", away: "A", home: "B" },
      { id: "b2", date: "5/9", away: "A", home: "C" },
      { id: "b3", date: "5/16", away: "B", home: "C" },
      { id: "b4", date: "5/23", away: "C", home: "A" },
      { id: "b5", date: "5/30", away: "B", home: "A" },
      { id: "b6", date: "6/6", away: "A", home: "C" },
    ];
    const scores = {
      b1: final(25, 0),
      b2: final(25, 0),
      b3: final(1, 0),
      b4: final(0, 25),
      b5: final(0, 25),
    };
    const prediction = buildPredictionEngine(
      calculateTeams(three, games, scores, DEFAULT_SETTINGS),
      games,
      scores,
      DEFAULT_SETTINGS
    ).predictions.find((one) => one.gameId === "b6");
    if (!prediction?.explanation) throw new Error("No explanation");
    const { parts } = prediction.explanation;
    expect(prediction.explanation.margin).toBe(14);
    expect(Object.values(parts).reduce((sum, value) => sum + value, 0)).toBeCloseTo(14, 10);
    expect(parts.capped).toBeLessThan(0);
    expect(parts.headToHead).toBeCloseTo(0.8, 10);
    expect(prediction.explanation.probabilityCapped).toBe(true);

    const explained = explainForecast(prediction, { nameOf });
    expect(
      explained?.factors.filter((factor) => factor.inMargin).map((factor) => factor.key)
    ).toEqual(["results", "schedule", "capped", "headToHead", "homeField"]);
    expect(explained?.factors.find((factor) => factor.key === "capped")?.text).toMatch(
      /^A projected margin stops at 14 runs, so \d+\.\d runs over it are left out\.$/
    );
    expect(explained?.strongest.teamB?.key).toBe("schedule");
  });

  it("never gives the cap as a reason for the side it takes nothing from", () => {
    // The Aces rout three teams the Bears lose to by as much: nothing here leans the Bears' way,
    // and the cap, which only takes runs off the Aces' margin, is no evidence for them.
    const games: Matchup[] = [
      { id: "r1", date: "5/2", away: "A", home: "C" },
      { id: "r2", date: "5/9", away: "A", home: "D" },
      { id: "r3", date: "5/16", away: "A", home: "E" },
      { id: "r4", date: "5/2", away: "B", home: "C" },
      { id: "r5", date: "5/9", away: "B", home: "D" },
      { id: "r6", date: "5/16", away: "B", home: "E" },
      { id: "r7", date: "5/23", away: "A", home: "B" },
    ];
    const scores = {
      r1: final(16, 0),
      r2: final(15, 0),
      r3: final(16, 1),
      r4: final(0, 15),
      r5: final(1, 16),
      r6: final(0, 15),
    };
    const prediction = explanationOf(engineFor(games, scores, []), "r7");
    if (!prediction.explanation) throw new Error("No explanation");
    expect(prediction.explanation.margin).toBe(14);
    expect(prediction.explanation.parts.capped).toBeLessThan(-1);

    const explained = explainForecast(prediction, { nameOf });
    const capped = explained?.factors.find((factor) => factor.key === "capped");
    expect(capped?.favors).toBeNull();
    expect(capped?.runs).toBeCloseTo(-prediction.explanation.parts.capped, 10);
    expect(explained?.strongest.teamA?.key).toBe("results");
    expect(explained?.strongest.teamB).toBeNull();
  });

  it("says a side's results are undated rather than guessing a day for them", () => {
    // The Eagles' league games without a date, and no tournament results.
    const undated: Matchup[] = matchups.map((game) =>
      game.id === "g4" || game.id === "g6" ? { ...game, date: "" } : game
    );
    const explained = explainForecast(explanationOf(engineFor(undated, logs, []), "g8"), {
      nameOf,
    });
    const freshness = explained?.factors.find((factor) => factor.key === "freshness");
    expect(freshness?.text).toContain("Eagles: none dated.");
    expect(explained?.sensitivities.join(" ")).not.toMatch(/Eagles's newest result/);
  });

  it("names no favorite in a game it reads as even", () => {
    const prediction = explanationOf(engineFor(), "g8");
    const even = {
      ...prediction,
      winProbability: { teamA: 0.5, teamB: 0.5 },
    };
    expect(explainForecast(even, { nameOf })?.favorite).toBeNull();
  });
});
