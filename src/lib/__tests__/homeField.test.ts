import { describe, expect, it } from "vitest";
import {
  calculateTeams,
  predictGame,
  rankOptionsFromSettings,
  rankTeams,
  simulateBracketOdds,
  simulationSeed,
} from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

/**
 * The model gives the home side an edge, and there were two places nothing was told which side
 * that was: the key a forecast is cached under did not record it, and a bracket seated the higher
 * seed as the visitor.
 */
const settings = { ...DEFAULT_SETTINGS, goldCutoff: 4 };

const bases: TeamBase[] = ["A", "B", "C", "D"].map((id) => ({ id, name: id }));

/** A finished season the seeds come out of in a plain order: A best, D worst. */
const season = () => {
  const games: Matchup[] = [];
  const logs: Record<string, GameLog> = {};
  let n = 0;
  const played = (away: string, home: string, a: number, h: number) => {
    const id = `g${n}`;
    n += 1;
    games.push({ id, date: "5/1", away, home });
    logs[id] = {
      awayRuns: String(a),
      awayHits: "5",
      awayK: "3",
      homeRuns: String(h),
      homeHits: "5",
      homeK: "3",
      innings: "6",
      isFinal: true,
    };
  };
  (
    [
      ["A", "B", 9, 3],
      ["A", "C", 10, 2],
      ["A", "D", 12, 1],
      ["B", "C", 8, 4],
      ["B", "D", 9, 3],
      ["C", "D", 7, 5],
    ] as const
  ).forEach(([x, y, a, h]) => {
    played(x, y, a, h);
    played(x, y, a, h);
  });
  return { games, logs };
};

describe("the seed a forecast is cached under", () => {
  it("tells a game still to play which side is at home", () => {
    /*
     * The two sides decide the home-field term, and the term decides the forecast — so leaving
     * them out left the key byte for byte identical across a swap while the odds moved by two and
     * a third points, and `resultKey === key` reported the stale answer as current.
     */
    const asIs: Matchup[] = [{ id: "g1", date: "5/1", away: "A", home: "B" }];
    const swapped: Matchup[] = [{ id: "g1", date: "5/1", away: "B", home: "A" }];

    expect(simulationSeed(asIs, {}, "odds")).not.toBe(simulationSeed(swapped, {}, "odds"));
  });

  it("says nothing new about a game already played, whose score is there", () => {
    const logs: Record<string, GameLog> = {
      g1: {
        awayRuns: "6",
        awayHits: "8",
        awayK: "4",
        homeRuns: "5",
        homeHits: "7",
        homeK: "5",
        innings: "6",
        isFinal: true,
      },
    };
    const games: Matchup[] = [{ id: "g1", date: "5/1", away: "A", home: "B" }];

    expect(simulationSeed(games, logs, "odds")).toBe("odds::g1|F6-5");
  });

  it("still moves when a score is corrected", () => {
    const games: Matchup[] = [{ id: "g1", date: "5/1", away: "A", home: "B" }];
    const log = (a: string, h: string): Record<string, GameLog> => ({
      g1: {
        awayRuns: a,
        awayHits: "8",
        awayK: "4",
        homeRuns: h,
        homeHits: "7",
        homeK: "5",
        innings: "6",
        isFinal: true,
      },
    });

    expect(simulationSeed(games, log("6", "5"), "odds")).not.toBe(
      simulationSeed(games, log("12", "0"), "odds")
    );
  });
});

describe("the model's home-field edge", () => {
  it("is worth more to a team at home than to the same team away", () => {
    const { games, logs } = season();
    const teams = rankTeams(
      calculateTeams(bases, games, logs, settings),
      rankOptionsFromSettings(settings)
    );

    const away = predictGame({ id: "x", date: "", away: "A", home: "D" }, teams, settings);
    const home = predictGame({ id: "x", date: "", away: "D", home: "A" }, teams, settings);

    // A's chance, from each seat. Home is the better one, which is what a bracket has to seat for.
    expect(1 - home.awayWinPct).toBeGreaterThan(away.awayWinPct);
  });
});

describe("a bracket game", () => {
  it("seats the higher seed at home, so the edge follows the seeding", () => {
    /*
     * `bracketSeedOrder` puts the higher seed in the top slot, and the top slot used to take the
     * away seat — handing the model's home-field term to the lower seed in every game of every
     * round. Here it is worth three and a third points of title odds to the top seed.
     */
    const { games, logs } = season();
    const teams = rankTeams(
      calculateTeams(bases, games, logs, settings),
      rankOptionsFromSettings(settings)
    );
    expect(teams.map((team) => team.id)).toEqual(["A", "B", "C", "D"]);

    const odds = simulateBracketOdds(teams, [], 4000, "pin", 4, settings);

    // The best team in the league is the likeliest champion, by a clear margin over the second.
    expect(odds.championOdds.A).toBeGreaterThan(odds.championOdds.B!);
    expect(odds.championOdds.A).toBeGreaterThan(37);
    // And the worst is the least likely.
    expect(odds.championOdds.D).toBeLessThan(odds.championOdds.C!);
  });
});
