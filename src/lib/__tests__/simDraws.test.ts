import { describe, expect, it } from "vitest";
import {
  calculateTeams,
  drawMargin,
  emptyTeam,
  gameStream,
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

/*
 * Two runs whose difference is what is wanted, the Gold trend's last two points (`buildTrendStates`):
 * the point before the last result has that game still to play. From one stream, its extra game
 * moved every draw after it, so the two runs drew every other game apart and their difference was
 * mostly chance. Paired, each game draws from its own stream, keyed to the season and the game.
 */
describe("a paired run", () => {
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
  const bases = ["A", "B", "C", "D"].map((id) => ({ id, name: id }));
  const all: Matchup[] = [
    { id: "p1", date: "5/1", away: "A", home: "C" },
    { id: "p2", date: "5/2", away: "B", home: "D" },
    { id: "g1", date: "5/8", away: "A", home: "B" },
    { id: "g2", date: "5/9", away: "C", home: "D" },
    { id: "g3", date: "5/15", away: "A", home: "D" },
    { id: "g4", date: "5/16", away: "B", home: "C" },
  ];
  const logs = { p1: final("5", "4"), p2: final("6", "3") };
  const teams = calculateTeams(bases, all, logs, DEFAULT_SETTINGS);
  const left = all.filter((one) => !(one.id in logs));
  // A game first in the list between two sides no league team is: it books nothing, and draws.
  const ghost: Matchup = { id: "ghost", date: "5/1", away: "X", home: "Y" };
  const odds = (remaining: Matchup[], paired: boolean) =>
    simulateGoldOddsRun(teams, remaining, 600, "paired", 2, DEFAULT_SETTINGS, undefined, paired)
      .odds;

  it("draws every other game alike when one more is played", () => {
    expect(odds([ghost, ...left], true)).toEqual(odds(left, true));
    // From one stream, the game moved every draw after it.
    expect(odds([ghost, ...left], false)).not.toEqual(odds(left, false));
  });

  it("plays every season asked for, so the two runs pair season for season", () => {
    // Everybody in: the odds are known at once, and a run on its own stops at the first check.
    const run = (paired: boolean) =>
      simulateGoldOddsRun(teams, left, 600, "all in", 4, DEFAULT_SETTINGS, undefined, paired);
    expect(run(false).iterations).toBe(200);
    expect(run(true).iterations).toBe(600);
  });

  it("keys one game's stream apart from the next one's", () => {
    /*
     * The key is put together from the seed, the season and the game's hashed id, and two keys a
     * letter apart, unmixed, seeded streams whose first draws stood a fixed distance apart: two
     * games of one season drew together. Over 200 seasons the distance between two games' first
     * draws took 2 values.
     */
    const seed = hashSeed("paired");
    const apart = new Set(
      Array.from({ length: 200 }, (_, season) => {
        const first = gameStream(seed, season, hashSeed("g10"))();
        const next = gameStream(seed, season, hashSeed("g11"))();
        return ((first - next + 1) % 1).toFixed(6);
      })
    );
    expect(apart.size).toBeGreaterThan(190);
  });

  it("draws each game of a season from a stream of its own, its odds a plain run's", () => {
    /*
     * Three level teams, each still to play the other two. Were every game of a season drawn from
     * one key, each would draw the same numbers: the away side would win all three or none, so A,
     * away twice, or C, home twice, would be first every season, and B never.
     */
    const level = ["A", "B", "C"].map((id) => ({ id, name: id }));
    const games: Matchup[] = [
      { id: "r1", date: "5/1", away: "A", home: "B" },
      { id: "r2", date: "5/2", away: "A", home: "C" },
      { id: "r3", date: "5/3", away: "B", home: "C" },
    ];
    const start = calculateTeams(level, games, {}, DEFAULT_SETTINGS);
    const oddsOf = (paired: boolean) =>
      simulateGoldOddsRun(start, games, 600, "level", 1, DEFAULT_SETTINGS, undefined, paired).odds;
    const plain = oddsOf(false);
    const paired = oddsOf(true);
    level.forEach(({ id }) => {
      expect(Math.abs((paired[id] ?? 0) - (plain[id] ?? 0))).toBeLessThan(8);
    });
  });

  /*
   * A league's first tie: the point before it has no share of ties to draw at, and made a draw
   * fewer each game than the point after, so the two drew every game apart and the step on that
   * result was two runs' worth of chance. A paired run makes the tie draw in every game.
   */
  it("makes the tie draw in every game, whether or not the league has had a tie", () => {
    const madeBy = (drawn: ReturnType<typeof draws>) => {
      let made = 0;
      const counted = {
        ...drawn,
        random: () => {
          made += 1;
          return 0.5;
        },
      };
      drawMargin(counted, 0.5, 0, true);
      return made;
    };
    const none = draws([team("A", 10), team("B", 10)]);
    const some = draws([team("A", 10, 2), team("B", 10)]);
    expect([madeBy(none), madeBy(some)]).toEqual([2, 3]);
    const pairedRun = { tieAlwaysDrawn: true as const };
    expect([madeBy({ ...none, ...pairedRun }), madeBy({ ...some, ...pairedRun })]).toEqual([3, 3]);
  });

  it("pairs the step on a league's first tie", () => {
    const tied = { ...logs, g1: final("4", "4") };
    const after = calculateTeams(bases, all, tied, DEFAULT_SETTINGS);
    const afterLeft = all.filter((one) => !(one.id in tied));
    const spread = (paired: boolean) => {
      const steps = Array.from({ length: 30 }, (_, at) => {
        const seed = `first tie ${at}`;
        const run = (from: Team[], remaining: Matchup[], seedText: string) =>
          simulateGoldOddsRun(
            from,
            remaining,
            600,
            seedText,
            2,
            DEFAULT_SETTINGS,
            undefined,
            paired
          ).odds;
        const later = run(after, afterLeft, seed);
        const sooner = run(teams, left, paired ? seed : `${seed} own`);
        // C and D, who were not in the game: their step is the most of it chance.
        return ["C", "D"].map((id) => (later[id] ?? 0) - (sooner[id] ?? 0));
      });
      const sd = (values: number[]) => {
        const middle = mean(values);
        return Math.sqrt(
          values.reduce((sum, value) => sum + (value - middle) ** 2, 0) / (values.length - 1)
        );
      };
      return mean([0, 1].map((side) => sd(steps.map((step) => step[side] ?? 0))));
    };
    /*
     * The step's spread from seed to seed, in points: 1.20 paired against 2.44 not, as it is 1.21
     * paired where the result is a win; 2.59 paired with the tie drawn only once a league has one.
     */
    expect(spread(true)).toBeLessThan(spread(false) * 0.6);
  });

  it("pairs the games owed beyond the schedule too, each drawing a stream of its own", () => {
    /*
     * Every team owes six games beyond the schedule (nine a team, three on it), so most of what is
     * left is owed. Drawn from the run's one stream, a tie drawn in one point and not the other
     * moved every owed draw after it, in that season and the ones after, and the step on a
     * league's first tie was two runs' worth of chance again (Codex, on #502).
     *
     * The two spreads play thirty pairs of 600-season runs each, 72,000 seasons in all, most of
     * their games owed. That took about 1.5 s alone and 3.6 s under coverage on a quiet four-core
     * machine, and ran past the 5 s default in CI's coverage run beside the other files (#505, on
     * 1 November 2026), so the test has room of its own, as the App's owed-games tests do.
     */
    const owing = { ...DEFAULT_SETTINGS, regularSeasonGamesPerTeam: 9 };
    const tied = { ...logs, g1: final("4", "4") };
    const before = calculateTeams(bases, all, logs, owing);
    const after = calculateTeams(bases, all, tied, owing);
    const afterLeft = all.filter((one) => !(one.id in tied));
    const spread = (paired: boolean) => {
      const steps = Array.from({ length: 30 }, (_, at) => {
        const seed = `owed first tie ${at}`;
        const run = (from: Team[], remaining: Matchup[], seedText: string) =>
          simulateGoldOddsRun(from, remaining, 600, seedText, 2, owing, undefined, paired).odds;
        const later = run(after, afterLeft, seed);
        const sooner = run(before, left, paired ? seed : `${seed} own`);
        return ["C", "D"].map((id) => (later[id] ?? 0) - (sooner[id] ?? 0));
      });
      const sd = (values: number[]) => {
        const middle = mean(values);
        return Math.sqrt(
          values.reduce((sum, value) => sum + (value - middle) ** 2, 0) / (values.length - 1)
        );
      };
      return mean([0, 1].map((side) => sd(steps.map((step) => step[side] ?? 0))));
    };
    expect(spread(true)).toBeLessThan(spread(false) * 0.6);
  }, 30_000);
});
