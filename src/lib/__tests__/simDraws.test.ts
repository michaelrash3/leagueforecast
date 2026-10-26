import { describe, expect, it } from "vitest";
import {
  calculateTeams,
  drawMargin,
  emptyTeam,
  hashSeed,
  makeRandom,
  seasonDraws,
  simulateGoldOddsRun,
} from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type Settings, type Team } from "../types";

/*
 * What a simulated game draws beyond who wins it (`drawMargin`): by how much, and whether it is
 * tied. Each game was booked at the model's predicted score, nudged so the drawn winner won, so no
 * simulated game was tied, every upset was won by a run and every favourite by its predicted
 * margin, and two teams level on points were split by run differential the same way every season.
 */

const team = (id: string, games: number, t = 0): Team => ({
  ...emptyTeam({ id, name: id }),
  games,
  t,
});

const draws = (teams: Team[], seed = "draws", settings: Settings = DEFAULT_SETTINGS) =>
  seasonDraws(teams, settings, makeRandom(hashSeed(seed)));

const margins = (
  chance: number,
  predicted: number,
  { seed = "margins", settings = DEFAULT_SETTINGS, times = 20_000, teams = [team("A", 5)] } = {}
) => {
  const drawn = draws(teams, seed, settings);
  return Array.from({ length: times }, () => drawMargin(drawn, chance, predicted, true));
};

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

describe("one game's margin", () => {
  it("goes the away side's way exactly as often as the model's chance says", () => {
    for (const [chance, predicted] of [
      [0.2, -4],
      [0.5, 0],
      [0.73, 3],
    ] as const) {
      const drawn = margins(chance, predicted, { seed: `chance ${chance}`, times: 40_000 });
      const away = drawn.filter((margin) => margin > 0).length / drawn.length;
      // Within three standard errors of the chance given: 0.7 of a point at even odds.
      expect(Math.abs(away - chance)).toBeLessThan(3 * Math.sqrt((chance * (1 - chance)) / 40_000));
    }
  });

  it("is a whole number of runs, never level in a league with no ties, and mostly more than one", () => {
    const drawn = margins(0.5, 0);
    expect(drawn.every((margin) => Number.isInteger(margin) && margin !== 0)).toBe(true);
    // Booked at the predicted score, an even game was won by one run, whichever side won it.
    expect(drawn.filter((margin) => Math.abs(margin) > 1).length / drawn.length).toBeGreaterThan(
      0.8
    );
    // On a normal curve 8.0 runs wide for kid pitch, an even game's margin averages about 6.4.
    const size = mean(drawn.map(Math.abs));
    expect(size).toBeGreaterThan(5.9);
    expect(size).toBeLessThan(6.9);
  });

  it("is narrower in machine and coach pitch, whose odds curve is", () => {
    const machine = { ...DEFAULT_SETTINGS, pitchMode: "machine" as const };
    const narrow = mean(margins(0.5, 0, { settings: machine }).map(Math.abs));
    expect(narrow).toBeLessThan(mean(margins(0.5, 0).map(Math.abs)) - 0.8);
  });

  it("falls around the predicted margin: a favourite wins by more than an upset does", () => {
    const drawn = margins(0.8, 6);
    const wins = drawn.filter((margin) => margin > 0);
    const upsets = drawn.filter((margin) => margin < 0).map((margin) => -margin);
    // Booked at the predicted score, the favourite won by 6 and every upset by 1. The curve around
    // 6, 8 runs wide, held above level: 6 + 8 × φ(0.75) / Φ(0.75), about 9.1.
    expect(mean(wins)).toBeGreaterThan(8.5);
    expect(mean(wins)).toBeLessThan(9.7);
    expect(upsets.some((margin) => margin >= 5)).toBe(true);
    expect(mean(upsets)).toBeLessThan(mean(wins));
  });
});

describe("ties", () => {
  it("are drawn at the league's own share, as though ten games without one came first", () => {
    // Eight teams with eighty games between them, eight of them tied: 16 tied sides of 160.
    const teams = Array.from({ length: 8 }, (_, at) => team(`T${at}`, 20, 2));
    expect(draws(teams).tieShare).toBeCloseTo(16 / (160 + 20), 9);
    const drawn = margins(0.5, 0, { teams, times: 40_000 });
    const tied = drawn.filter((margin) => margin === 0).length / drawn.length;
    expect(Math.abs(tied - 16 / 180)).toBeLessThan(0.005);
  });

  it("are never drawn in a league that has had none, nor in a game that must have a winner", () => {
    expect(draws([team("A", 10), team("B", 10)]).tieShare).toBe(0);
    const drawn = draws([team("A", 10, 5), team("B", 10, 5)]);
    for (let i = 0; i < 5_000; i += 1) expect(drawMargin(drawn, 0.5, 0, false)).not.toBe(0);
  });
});

describe("the Gold odds' counts for the team followed", () => {
  const final = (away: string, home: string): GameLog => ({
    awayRuns: away,
    homeRuns: home,
    awayHits: "",
    homeHits: "",
    awayK: "",
    homeK: "",
    innings: "6",
    isFinal: true,
  });

  it("leave a tied season out of both sides of a game", () => {
    const bases = ["A", "B", "C", "D"].map((id) => ({ id, name: id }));
    const all: Matchup[] = [
      { id: "p1", date: "5/1", away: "A", home: "C" },
      { id: "p2", date: "5/2", away: "B", home: "D" },
      { id: "g1", date: "5/8", away: "A", home: "B" },
      { id: "g2", date: "5/9", away: "C", home: "D" },
    ];
    // One of the two games played was tied, so the league draws ties.
    const logs = { p1: final("4", "4"), p2: final("6", "3") };
    const teams = calculateTeams(bases, all, logs, DEFAULT_SETTINGS);
    const left = all.filter((one) => !(one.id in logs));
    const run = simulateGoldOddsRun(teams, left, 2000, "ties", 2, DEFAULT_SETTINGS, "A");
    const swing = run.swing;
    expect(swing).toBeDefined();
    if (!swing) return;
    const at = swing.gameIds.indexOf("g1");
    const decided = (swing.awayWins[at] ?? 0) + (swing.homeWins[at] ?? 0);
    expect(decided).toBeLessThan(swing.seasons);
    expect(decided).toBeGreaterThan(swing.seasons * 0.8);
  });
});
