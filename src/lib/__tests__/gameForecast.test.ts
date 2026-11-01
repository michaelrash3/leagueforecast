import { describe, expect, it } from "vitest";
import { forecastGame } from "../gameForecast";
import { buildPredictionEngine } from "../predictionEngine";
import {
  attachAdjustedRatings,
  calculateTeams,
  drawMargin,
  drawnMarginSpan,
  drawnRuns,
  drawWidths,
  emptyTeam,
  hashSeed,
  makeRandom,
  predictGame,
  seasonDraws,
  type GameRead,
} from "../sim";
import {
  DEFAULT_SETTINGS,
  type GameLog,
  type Matchup,
  type PitchMode,
  type TeamBase,
} from "../types";

/*
 * A game card's forecast (`forecastGame`): the win chance, the projected score and the range, all
 * from the per-game model the Gold odds play by (`predictGame`), the range being what the Gold odds
 * themselves draw for the game (`drawMargin`) eight times in ten. The card used to give the
 * prediction engine's expected score and a range around the engine's margin beside the per-game
 * model's chance: Aces 65% to win, expected 6.4 to 2.9, where the model the Gold odds play had them
 * 8 to 3. Placeholder teams.
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
];
const matchups: Matchup[] = [
  { id: "g1", date: "5/2", away: "A", home: "B" },
  { id: "g2", date: "5/9", away: "B", home: "C" },
  { id: "g3", date: "5/16", away: "C", home: "A" },
  { id: "g4", date: "5/23", away: "A", home: "B" },
];
const played = { g1: final(8, 2), g2: final(5, 4), g3: final(3, 6) };
const next = matchups[3] as Matchup;

const leagueAt = (pitchMode: PitchMode, logs: Record<string, GameLog> = played) => {
  const settings = { ...DEFAULT_SETTINGS, pitchMode };
  const live = calculateTeams(teams, matchups, logs, settings);
  const engine = buildPredictionEngine(live, matchups, logs, settings);
  return { settings, rated: attachAdjustedRatings(live, engine.ratings) };
};

/** How often a list of drawn margins falls below a value, and at or below it. */
const shares = (drawn: readonly number[], value: number) => ({
  below: drawn.filter((margin) => margin < value).length / drawn.length,
  atMost: drawn.filter((margin) => margin <= value).length / drawn.length,
});

describe("the margins a game is drawn at, eight in ten (`drawnMarginSpan`)", () => {
  it.each([
    { chance: 0.65, predicted: 5, tieShare: 0, pitch: "player" },
    { chance: 0.5, predicted: 0, tieShare: 0, pitch: "player" },
    { chance: 0.3, predicted: 2, tieShare: 0, pitch: "machine" },
    { chance: 0.9, predicted: 11, tieShare: 0, pitch: "player" },
    { chance: 0.52, predicted: -1, tieShare: 0.08, pitch: "player" },
  ] as const)(
    "are the tenth and ninetieth of the margins drawMargin draws ($chance at $predicted)",
    ({ chance, predicted, tieShare, pitch }) => {
      const widths = { ...drawWidths([], { pitchMode: pitch }), tieShare };
      const span = drawnMarginSpan(widths, chance, predicted);
      const random = makeRandom(hashSeed(`span ${chance} ${predicted}`));
      const drawn = Array.from({ length: 200_000 }, () =>
        drawMargin({ ...widths, random }, chance, predicted, true)
      );
      // The low end is the tenth: fewer than one in ten below it, and one in ten at or below it.
      // Three standard errors of a tenth over 200,000 draws is 0.002.
      const low = shares(drawn, span.low);
      expect(low.below).toBeLessThan(0.1 + 0.002);
      expect(low.atMost).toBeGreaterThan(0.1 - 0.002);
      const high = shares(drawn, span.high + 1);
      expect(high.below).toBeGreaterThan(0.9 - 0.002);
      expect(shares(drawn, span.high).below).toBeLessThan(0.9 + 0.002);
    }
  );

  it("is wider at kid pitch than at machine and coach pitch, as the curve they are drawn on", () => {
    const kid = drawnMarginSpan(drawWidths([], { pitchMode: "player" }), 0.5, 0);
    const machine = drawnMarginSpan(drawWidths([], { pitchMode: "machine" }), 0.5, 0);
    const coach = drawnMarginSpan(drawWidths([], { pitchMode: "coach" }), 0.5, 0);
    // 8.0 runs wide either side of level, 1.28 of it to the tenth: 10.25 runs, and 8.6 at 6.7.
    expect(kid).toEqual({ low: -10, high: 10 });
    expect(machine).toEqual({ low: -9, high: 9 });
    expect(coach).toEqual(machine);
  });

  it("reads the league's ties as the Gold odds draw them, from the same share", () => {
    const tied = [{ ...emptyTeam({ id: "A", name: "Aces" }), games: 10, t: 3 }];
    expect(drawWidths(tied, DEFAULT_SETTINGS)).toEqual({
      tieShare: seasonDraws(tied, DEFAULT_SETTINGS, Math.random).tieShare,
      spread: seasonDraws(tied, DEFAULT_SETTINGS, Math.random).spread,
    });
  });
});

describe("a drawn margin's two scores (`drawnRuns`)", () => {
  it("splits the projected total so the margin is the one drawn, the loser never below none", () => {
    for (const total of [3, 8, 11, 20])
      for (let margin = -25; margin <= 25; margin += 1) {
        const away = drawnRuns(total, margin);
        const home = drawnRuns(total, -margin);
        expect(away - home, `${total} by ${margin}`).toBe(margin);
        expect(Math.min(away, home)).toBeGreaterThanOrEqual(0);
      }
    // An upset by 6 in a game projected to total 11: 3 to 9; a rout by 15, 15 to none.
    expect([drawnRuns(11, -6), drawnRuns(11, 6)]).toEqual([3, 9]);
    expect([drawnRuns(11, 15), drawnRuns(11, -15)]).toEqual([15, 0]);
  });
});

describe("the per-game model's reading of a game (`GameRead`)", () => {
  it("is asked for without changing the forecast", () => {
    for (const pitchMode of ["player", "machine"] as const) {
      const { settings, rated } = leagueAt(pitchMode);
      const read: GameRead = { runs: null, rating: null, weight: 0, margin: 0 };
      expect(predictGame(next, rated, settings, undefined, undefined, read)).toEqual(
        predictGame(next, rated, settings)
      );
      // The two readings, counted at the weight, are the margin the score is split from.
      if (read.runs === null || read.rating === null) throw new Error("No reading");
      expect(read.margin).toBeCloseTo(read.runs + read.weight * (read.rating - read.runs), 9);
      const prediction = predictGame(next, rated, settings);
      expect(Math.abs(prediction.awayScore - prediction.homeScore - read.margin)).toBeLessThan(1);
    }
  });

  it("has the ratings' margin and their weight, and runs alone where a side carries none", () => {
    const { settings, rated } = leagueAt("player");
    const read: GameRead = { runs: null, rating: null, weight: 0, margin: 0 };
    predictGame(next, rated, settings, undefined, undefined, read);
    const [aces, bears] = rated;
    expect(read.rating).toBeCloseTo((aces?.adjustedRating ?? 0) - (bears?.adjustedRating ?? 0), 9);
    // Two rated games behind the thinner side: 0.4 + 0.6 × 2 / (2 + 4).
    expect(read.weight).toBeCloseTo(0.6, 9);

    const unrated = rated.map(({ adjustedRating: _rating, ratedGames: _games, ...team }) => team);
    const alone: GameRead = { runs: null, rating: null, weight: 0, margin: 0 };
    predictGame(next, unrated, settings, undefined, undefined, alone);
    expect(alone).toEqual({ runs: read.runs, rating: null, weight: 0, margin: read.runs });
  });

  it("reads no runs where a side has played fewer than two league games", () => {
    const { settings, rated } = leagueAt("player", { g1: final(8, 2) });
    const read: GameRead = { runs: null, rating: null, weight: 0, margin: 0 };
    predictGame(next, rated, settings, undefined, undefined, read);
    expect(read.runs).toBeNull();
    expect(read.rating).not.toBeNull();
    expect(read.margin).toBeCloseTo(read.weight * (read.rating ?? 0), 9);
  });
});

describe("a game card's forecast (`forecastGame`)", () => {
  it("is the per-game model's chance and score, with the margins the Gold odds draw it at", () => {
    const { settings, rated } = leagueAt("player");
    const forecast = forecastGame(next, rated, settings);
    const prediction = predictGame(next, rated, settings);
    expect(forecast).toMatchObject({
      awayWinPct: prediction.awayWinPct,
      awayScore: 8,
      homeScore: 3,
      scored: true,
      few: [],
    });
    // Aces 8 to 3 at 65%: the margin on the curve 8.0 runs wide around 5, on the winner's side.
    expect(forecast.range).toEqual({
      margin: { low: -6, high: 15 },
      away: { low: 3, high: 15 },
      home: { low: 0, high: 9 },
    });
  });

  it("is narrower at machine pitch, as the Gold odds draw it", () => {
    const { settings, rated } = leagueAt("machine");
    const forecast = forecastGame(next, rated, settings);
    expect([forecast.awayScore, forecast.homeScore]).toEqual([9, 3]);
    expect(forecast.range).toEqual({
      margin: { low: -5, high: 14 },
      away: { low: 4, high: 14 },
      home: { low: 0, high: 9 },
    });
  });

  it("says when there is no final to put a scoring level on, and who has too few games", () => {
    const { settings, rated } = leagueAt("player", {});
    expect(forecastGame(next, rated, settings)).toMatchObject({
      scored: false,
      few: ["away", "home"],
    });
    const one = leagueAt("player", { g1: final(8, 2), g2: final(5, 4) });
    expect(forecastGame(next, one.rated, one.settings).few).toEqual(["away"]);
  });
});
