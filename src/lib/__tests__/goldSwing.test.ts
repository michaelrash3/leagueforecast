import { describe, expect, it } from "vitest";
import { ownGameSwing, rootFor } from "../goldSwing";
import {
  calculateTeams,
  rankOptionsFromSettings,
  rankTeams,
  simulateGoldOddsRun,
  type GoldSwing,
} from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

const games: Matchup[] = [
  { id: "g1", date: "5/1", away: "A", home: "B" },
  { id: "g2", date: "5/2", away: "B", home: "C" },
  { id: "g3", date: "5/3", away: "C", home: "D" },
];

const swing = (over: Partial<GoldSwing> = {}): GoldSwing => ({
  teamId: "A",
  seasons: 1000,
  gameIds: ["g1", "g2", "g3"],
  awayWins: [500, 500, 500],
  inIfAway: [400, 100, 250],
  inIfHome: [100, 400, 260],
  ...over,
});

describe("ownGameSwing", () => {
  it("reads the team's chance with a win and with a loss, from whichever side it is on", () => {
    expect(ownGameSwing(swing(), games[0]!)).toEqual({ ifWin: 0.8, ifLoss: 0.2 });
    expect(ownGameSwing({ ...swing(), teamId: "B" }, games[0]!)).toEqual({
      ifWin: 0.2,
      ifLoss: 0.8,
    });
  });

  it("says nothing of a game the team is not in, or one a side almost never wins", () => {
    expect(ownGameSwing(swing(), games[1]!)).toBeNull();
    expect(ownGameSwing(swing({ awayWins: [990, 500, 500] }), games[0]!)).toBeNull();
  });
});

describe("rootFor", () => {
  it("names who to root for in the games the team is not in, where it clearly matters", () => {
    // g2: the Comets beating the Bears takes A from 20% to 80%. g3 moves it by a point: noise.
    expect(rootFor(swing(), games)).toEqual([
      { gameId: "g2", date: "5/2", winnerId: "C", loserId: "B", ifWin: 0.8, ifLoss: 0.2 },
    ]);
  });
});

describe("the swing from the Gold odds", () => {
  const bases: TeamBase[] = ["A", "B", "C", "D"].map((id) => ({ id, name: id }));
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
  const all: Matchup[] = [
    { id: "p1", date: "5/1", away: "A", home: "C" },
    { id: "p2", date: "5/2", away: "B", home: "D" },
    { id: "g1", date: "5/8", away: "A", home: "B" },
    { id: "g2", date: "5/9", away: "C", home: "D" },
  ];
  const logs = { p1: final("6", "2"), p2: final("4", "3") };
  const teams = rankTeams(
    calculateTeams(bases, all, logs, DEFAULT_SETTINGS),
    rankOptionsFromSettings(DEFAULT_SETTINGS)
  );
  const left = all.filter((game) => !(game.id in logs));

  it("leaves the odds the same to the digit", () => {
    const plain = simulateGoldOddsRun(teams, left, 2000, "pin", 1, DEFAULT_SETTINGS);
    const followed = simulateGoldOddsRun(teams, left, 2000, "pin", 1, DEFAULT_SETTINGS, "A");

    expect(followed.odds).toEqual(plain.odds);
    expect(followed.iterations).toBe(plain.iterations);
    expect(plain.swing).toBeUndefined();
  });

  it("counts the seasons the followed team made the cut, by how each game went", () => {
    const { odds, swing: read } = simulateGoldOddsRun(
      teams,
      left,
      2000,
      "pin",
      1,
      DEFAULT_SETTINGS,
      "A"
    );
    expect(read).toBeDefined();
    if (!read) return;
    const at = read.gameIds.indexOf("g1");
    // Every season that put A in falls on one side of g1 or the other.
    expect((read.inIfAway[at] ?? 0) + (read.inIfHome[at] ?? 0)).toBe(
      Math.round(((odds.A ?? 0) / 100) * read.seasons)
    );
    // A, away in g1, is far likelier in with a win.
    expect(ownGameSwing(read, left[0]!)!.ifWin).toBeGreaterThan(
      ownGameSwing(read, left[0]!)!.ifLoss
    );
  });
});
