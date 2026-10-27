import { describe, expect, it } from "vitest";
import { chanceAt, MODEL_VARIANTS, runModelSweep } from "../modelSweep";
import {
  fitScoutYear,
  MATCHUP_MARGIN_CAP,
  predictMatchup,
  RATING_CAP,
  scoutRatingGames,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

/*
 * The research sweep of the shipped model (`modelSweep.ts`) on a made-up autumn: sixteen clubs of
 * known strength playing one another from August to October 2026, scored on the games after 23
 * September as the boards of 1, 8 and 15 September would have forecast them.
 */

const PAGE = "ag_10u_2027";
const groups: AgeGroup[] = [{ id: PAGE, name: "10U 2027", year: 2027 } as AgeGroup];
const CLUBS = 16;
const teams: ScoutTeam[] = Array.from({ length: CLUBS }, (_, at) => ({
  id: `S-${at}`,
  name: `Club ${at}`,
}));

/** mulberry32: the same draw on every machine. */
const draw = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Each club plays every other twice, once in the first half of the autumn and once after. */
const autumn = (): ScoutGame[] => {
  const random = draw(7);
  const strength = (at: number) => (at - CLUBS / 2) * 0.9;
  const games: ScoutGame[] = [];
  const dayOf = (index: number) => {
    // 10 August to 10 October 2026, a day for each step.
    const day = new Date(Date.UTC(2026, 7, 10 + (index % 62)));
    return day.toISOString().slice(0, 10);
  };
  let index = 0;
  for (let round = 0; round < 2; round += 1) {
    for (let a = 0; a < CLUBS; a += 1) {
      for (let b = a + 1; b < CLUBS; b += 1) {
        const noise = (random() - 0.5) * 12;
        const margin = Math.round(strength(a) - strength(b) + noise);
        const base = 3 + Math.floor(random() * 4);
        const date = dayOf(round * 31 + (index % 31));
        index += 1;
        games.push({
          id: `g${round}-${a}-${b}`,
          ageGroupId: PAGE,
          teamAId: `S-${a}`,
          teamBId: `S-${b}`,
          teamAScore: base + Math.max(0, margin),
          teamBScore: base + Math.max(0, -margin),
          date,
        });
      }
    }
  }
  return games;
};

const games = autumn();
const sweep = runModelSweep({ ageGroups: groups, teams, games, year: 2027, today: "2026-10-31" });

describe("the research sweep of the shipped model", () => {
  it("reads a matchup's chance as the boards do at the shipped floor, to the digit", () => {
    for (const [a, b, level] of [
      [3.2, -1.1, 10],
      [-20, 4, 12],
      [0, 0, undefined],
      [15, -15, 9],
    ] as const) {
      expect(chanceAt(a, b, level)).toBe(predictMatchup(a, b, level).winProbA);
    }
    // A lower floor lets a wide margin's chance further toward certain; a near one is untouched.
    expect(chanceAt(12, 0, 10, 0.02)).toBeGreaterThan(chanceAt(12, 0, 10));
    expect(chanceAt(2, 0, 10, 0.02)).toBe(chanceAt(2, 0, 10));
  });

  it("widens the odds curve by a multiple, the chance only, the shipped curve at one", () => {
    // At one the chance is the boards' to the digit; wider, a margin's chance sits nearer evens.
    expect(chanceAt(5, 0, 10, undefined, 1)).toBe(predictMatchup(5, 0, 10).winProbA);
    expect(chanceAt(5, 0, 10, undefined, 1.2)).toBeLessThan(chanceAt(5, 0, 10));
    expect(chanceAt(5, 0, 10, undefined, 1.2)).toBeGreaterThan(0.5);
    expect(chanceAt(0, 5, 10, undefined, 1.2)).toBeGreaterThan(chanceAt(0, 5, 10));
    const of = (key: string) => sweep.variants.find((variant) => variant.key === key)!;
    // The fit is the shipped one, so the margin's error is the shipped one's to the digit, and
    // the chances, and so the log loss, are not.
    expect(of("spread-1.2").vsShipped?.squared?.by).toBe(0);
    expect(of("spread-1.2").logLoss).not.toBe(of("shipped").logLoss);
  });

  it("fits each cut on the games before it and scores the games after the scoring day", () => {
    expect(sweep.cuts.map((cut) => cut.cut)).toEqual(["2026-09-01", "2026-09-08", "2026-09-15"]);
    const trained = sweep.cuts.map((cut) => cut.trained);
    expect(trained[0]).toBeLessThan(trained[1]!);
    expect(trained[1]).toBeLessThan(trained[2]!);
    // The same later games at every cut: every club was rated by the first.
    const later = scoutRatingGames(PAGE, teams, games, groups, undefined, "2026-10-31").filter(
      ({ game }) => (game.date ?? "") >= "2026-09-23"
    ).length;
    expect(sweep.cuts.every((cut) => cut.scored === later)).toBe(true);
    expect(sweep.games).toBe(later * 3);
  });

  it("forecasts better than a coin, and pairs every setting against the shipped one", () => {
    const shipped = sweep.variants[0]!;
    expect(shipped.key).toBe("shipped");
    expect(shipped.vsShipped).toBeNull();
    // A coin's log loss is ln 2 and its Brier score a quarter; strengths this far apart beat it.
    expect(shipped.logLoss).toBeLessThan(Math.log(2));
    expect(shipped.brier).toBeLessThan(0.25);
    expect(sweep.variants.map((variant) => variant.key)).toEqual(
      MODEL_VARIANTS.map((variant) => variant.key)
    );
    for (const variant of sweep.variants.slice(1)) {
      expect(variant.vsShipped?.logLoss?.samples).toBe(sweep.decided);
      expect(variant.vsShipped?.squared?.samples).toBe(sweep.games);
    }
  });

  it("moves the fit with the ridge and the cap, and only the chance with the floor", () => {
    const of = (key: string) => sweep.variants.find((variant) => variant.key === key)!;
    expect(of("ridge-3").vsShipped?.squared?.by).not.toBe(0);
    expect(of("cap-8").vsShipped?.squared?.by).not.toBe(0);
    // A floor leaves the fit alone, so the margin's error is the shipped one's to the digit.
    expect(of("floor-0.02").vsShipped?.squared?.by).toBe(0);
    // And a fit given no tuning is the boards' fit.
    const trained = scoutRatingGames(PAGE, teams, games, groups, undefined, "2026-09-15");
    const plain = fitScoutYear(2027, teams, games, trained, groups);
    const tuned = fitScoutYear(2027, teams, games, trained, groups, {});
    expect([...tuned.adjusted.ratings]).toEqual([...plain.adjusted.ratings]);
  });

  it("scores the margin a board states, held to the matchup's cap, not the ratings' whole gap", () => {
    // A ladder: each club beats the next by twelve, four times in August, so the top and bottom
    // are rated far more than the 14 runs a matchup is stated to apart. Their later games, won by
    // 20 and so read as 12, are scored on the 14 a board says, either way round: 2 runs out each.
    const ladder: ScoutTeam[] = Array.from({ length: 6 }, (_, at) => ({
      id: `L-${at}`,
      name: `Rung ${at}`,
    }));
    const climbs: ScoutGame[] = ladder.slice(1).flatMap((_, at) =>
      [0, 1, 2, 3].map((round) => ({
        id: `c${at}-${round}`,
        ageGroupId: PAGE,
        teamAId: `L-${at}`,
        teamBId: `L-${at + 1}`,
        teamAScore: 14,
        teamBScore: 2,
        date: `2026-08-${String(10 + round * 4 + at).padStart(2, "0")}`,
      }))
    );
    const top: ScoutGame = {
      id: "top",
      ageGroupId: PAGE,
      teamAId: "L-0",
      teamBId: "L-5",
      teamAScore: 20,
      teamBScore: 0,
      date: "2026-09-30",
    };
    const bottomFirst: ScoutGame = {
      id: "bottom",
      ageGroupId: PAGE,
      teamAId: "L-5",
      teamBId: "L-0",
      teamAScore: 0,
      teamBScore: 20,
      date: "2026-10-02",
    };
    const wide = runModelSweep({
      ageGroups: groups,
      teams: ladder,
      games: [...climbs, top, bottomFirst],
      year: 2027,
      today: "2026-10-31",
      cuts: ["2026-09-01"],
      variants: [MODEL_VARIANTS[0]!],
    });
    expect(wide.games).toBe(2);
    expect(wide.variants[0]!.squared).toBe((MATCHUP_MARGIN_CAP - RATING_CAP) ** 2);
  });

  it("scores only the matchups a board states, and counts a game across ages apart", () => {
    // A board's clubs are one age, so no board states a forecast for a game across ages. An 11U
    // club plays five of the 10Us in August, each side's level recorded, in both pools; its later
    // game against one of them is left out of every reading and counted at each cut. Nobody's
    // level moves with it, so every reading must be the same to the digit.
    const older: ScoutTeam = { id: "S-OLD", name: "Older" };
    const across = (id: string, a: number, date: string, scores: [number, number]): ScoutGame => ({
      id,
      ageGroupId: PAGE,
      teamAId: `S-${a}`,
      teamBId: "S-OLD",
      teamAScore: scores[0],
      teamBScore: scores[1],
      ageLevelA: 10,
      ageLevelB: 11,
      date,
    });
    const august = [0, 1, 2, 3, 4].map((a) =>
      across(`up-${a}`, a, `2026-08-${12 + a}`, [3 + a, 6])
    );
    const pool = (extra: ScoutGame[]) =>
      runModelSweep({
        ageGroups: groups,
        teams: [...teams, older],
        games: [...games, ...august, ...extra],
        year: 2027,
        today: "2026-10-31",
      });
    const without = pool([]);
    const withIt = pool([across("later", 3, "2026-10-01", [4, 9])]);
    expect(sweep.crossAge).toBe(0);
    expect(without.crossAge).toBe(0);
    expect(withIt.crossAge).toBe(3);
    expect(withIt.games).toBe(without.games);
    const readings = (of: typeof sweep) =>
      of.variants.map(({ logLoss, brier, squared }) => [logLoss, brier, squared]);
    expect(readings(withIt)).toEqual(readings(without));
    expect(withIt.calibration).toEqual(without.calibration);
  });

  it("counts a stand-in's game apart: no board lists a club known only by name, or a slot", () => {
    // A club known only from somebody else's schedule plays four of the 10Us in August, in both
    // pools, so it is in every fit as an opponent; its later game is left out of every reading.
    const named: ScoutTeam = { id: "N-1", name: "Somebody's Opponent", nameOnly: true };
    const meeting = (id: string, a: number, date: string, scores: [number, number]): ScoutGame => ({
      id,
      ageGroupId: PAGE,
      teamAId: `S-${a}`,
      teamBId: "N-1",
      teamAScore: scores[0],
      teamBScore: scores[1],
      date,
    });
    const august = [0, 1, 2, 3].map((a) =>
      meeting(`named-${a}`, a, `2026-08-${20 + a}`, [5, 2 + a])
    );
    const pool = (extra: ScoutGame[]) =>
      runModelSweep({
        ageGroups: groups,
        teams: [...teams, named],
        games: [...games, ...august, ...extra],
        year: 2027,
        today: "2026-10-31",
      });
    const without = pool([]);
    const withIt = pool([meeting("later-named", 5, "2026-10-02", [7, 3])]);
    expect(sweep.standIns).toBe(0);
    expect(without.standIns).toBe(0);
    expect(withIt.standIns).toBe(3);
    expect(withIt.crossAge).toBe(0);
    expect(withIt.games).toBe(without.games);
    const readings = (of: typeof sweep) =>
      of.variants.map(({ logLoss, brier, squared }) => [logLoss, brier, squared]);
    expect(readings(withIt)).toEqual(readings(without));
    expect(withIt.calibration).toEqual(without.calibration);
  });

  it("bands the favourite's chance and how often it won, every decided game in one band", () => {
    expect(sweep.calibration).toHaveLength(10);
    expect(sweep.calibration.reduce((sum, band) => sum + band.games, 0)).toBe(sweep.decided / 1);
    for (const band of sweep.calibration.filter((one) => one.games > 0)) {
      expect(band.said).toBeGreaterThanOrEqual(band.from - 1e-9);
      expect(band.said).toBeLessThanOrEqual(band.to + 1e-9);
    }
  });
});
