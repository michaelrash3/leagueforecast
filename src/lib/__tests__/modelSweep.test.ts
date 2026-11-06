import { describe, expect, it } from "vitest";
import { chanceAt, MODEL_VARIANTS, runModelSweep, type ModelVariant } from "../modelSweep";
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
      // With the two clubs' errors, the curve as wide as their evidence, as the boards read it.
      const errors = { a: 0.8, b: 2.1 };
      expect(chanceAt(a, b, level, undefined, { errors })).toBe(
        predictMatchup(a, b, level, errors).winProbA
      );
    }
    // A lower floor lets a wide margin's chance further toward certain; a near one is untouched.
    expect(chanceAt(12, 0, 10, 0.02)).toBeGreaterThan(chanceAt(12, 0, 10));
    expect(chanceAt(2, 0, 10, 0.02)).toBe(chanceAt(2, 0, 10));
  });

  it("reads the single curve of the age at a share of one and no weight, wider nearer evens", () => {
    const errors = { a: 1.3, b: 0.7 };
    // A share of one and no weight is the single curve, which the boards read without errors.
    expect(chanceAt(5, 0, 10, undefined, { share: 1, weight: 0, errors })).toBe(
      predictMatchup(5, 0, 10).winProbA
    );
    // A wider share reads a margin's chance nearer evens, either way round.
    const wide = { share: 1.2, weight: 0, errors };
    expect(chanceAt(5, 0, 10, undefined, wide)).toBeLessThan(chanceAt(5, 0, 10));
    expect(chanceAt(5, 0, 10, undefined, wide)).toBeGreaterThan(0.5);
    expect(chanceAt(0, 5, 10, undefined, wide)).toBeGreaterThan(chanceAt(0, 5, 10));
    const of = (key: string) => sweep.variants.find((variant) => variant.key === key)!;
    // The fit is the shipped one, so the margin's error is the shipped one's to the digit, and
    // the chances, and so the log loss, are not.
    expect(of("single-1.05").vsShipped?.squared?.by).toBe(0);
    expect(of("single-1.05").logLoss).not.toBe(of("shipped").logLoss);
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

  it("reads every setting it read before the curve read the clubs' errors, to the digit, on the single curve", () => {
    // Snapshotted on this autumn before a matchup could read the fit's own ratings or widen with
    // the two clubs' errors, when every setting read the single curve of the age: each setting
    // read on that curve again says what it said then, so only the curve the boards read moved.
    const sameAsBefore = (key: string): ModelVariant => {
      const [kind, number] = [key.split("-")[0], Number(key.split("-")[1])];
      const fit = MODEL_VARIANTS.find((variant) => variant.key === key);
      const setting: Partial<ModelVariant> =
        kind === "spread" ? { share: number } : kind === "shipped" ? {} : { ...fit };
      return { ...setting, key, why: "as read before", share: setting.share ?? 1, weight: 0 };
    };
    const before: Array<[string, number, number, number]> = [
      ["shipped", 0.46241948674893774, 0.14863800042381828, 14.338066623403552],
      ["ridge-0.75", 0.4562101380167666, 0.14674938243216992, 14.349836506488595],
      ["ridge-1.125", 0.45935948073250754, 0.14769767581457152, 14.325294614672012],
      ["ridge-2.25", 0.46831020897294945, 0.1504947334548658, 14.449416899309874],
      ["ridge-3", 0.473951938070658, 0.152321311327631, 14.643760599607816],
      ["cap-8", 0.47752561636129387, 0.15232868747867953, 14.739174100090514],
      ["cap-10", 0.4665946382837112, 0.1493933981104443, 14.262490847475783],
      ["cap-14", 0.4608923992709079, 0.14847708339682988, 14.562694005147714],
      ["cap-16", 0.4614235901217123, 0.14897055790674846, 14.723825918672196],
      ["floor-0.02", 0.4622593730747873, 0.1486158010173229, 14.338066623403552],
      ["floor-0.05", 0.4622593730747873, 0.1486158010173229, 14.338066623403552],
      ["floor-0.12", 0.46427080798622405, 0.14898831762365747, 14.338066623403552],
      ["spread-0.95", 0.457133100326638, 0.1471632951073544, 14.338066623403552],
      ["spread-1.05", 0.4676351111540156, 0.15017832740904502, 14.338066623403552],
      ["spread-1.1", 0.4728465224788286, 0.15177718178783234, 14.338066623403552],
      ["spread-1.15", 0.4779605764045595, 0.1534073109078795, 14.338066623403552],
      ["spread-1.2", 0.48293464231538896, 0.15505024692420374, 14.338066623403552],
      ["spread-1.3", 0.4924340184480712, 0.15833135143277183, 14.338066623403552],
    ];
    const onTheSingleCurve = runModelSweep({
      ageGroups: groups,
      teams,
      games,
      year: 2027,
      today: "2026-10-31",
      variants: before.map(([key]) => sameAsBefore(key)),
    });
    for (const [key, logLoss, brier, squared] of before) {
      const reading = onTheSingleCurve.variants.find((variant) => variant.key === key)!;
      expect([key, reading.logLoss, reading.brier, reading.squared]).toEqual([
        key,
        logLoss,
        brier,
        squared,
      ]);
    }
    expect(onTheSingleCurve.games).toBe(204);
    expect(onTheSingleCurve.decided).toBe(198);
    expect(onTheSingleCurve.calibration.map(({ games, said, won }) => [games, said, won])).toEqual([
      [19, 0.5207122576686494, 0.8421052631578947],
      [28, 0.5766439916845914, 0.6071428571428571],
      [18, 0.6253034990956898, 0.5],
      [34, 0.6753987733215596, 0.5588235294117647],
      [23, 0.7253934582683942, 0.9565217391304348],
      [19, 0.768664657377895, 1],
      [30, 0.8224639446505839, 1],
      [17, 0.8690263016530558, 1],
      [10, 0.9084951026866447, 1],
      [0, Number.NaN, Number.NaN],
    ]);
  });

  it("widens a matchup's curve by its weight of the two errors' variance, and by nothing at none", () => {
    // At 10U the spread is 4.345 runs: a share of one and a weight of one over errors whose squares
    // sum to 4 make the width sqrt(4.345² + 4), about 4.78.
    const errors = { a: Math.SQRT2, b: Math.SQRT2 };
    const width = Math.sqrt(4.345 ** 2 + 4);
    const one = { share: 1, weight: 1, errors };
    expect(chanceAt(5, 0, 10, undefined, one)).toBeCloseTo(1 / (1 + Math.exp(-5 / width)), 12);
    expect(chanceAt(5, 0, 10, undefined, one)).toBeLessThan(chanceAt(5, 0, 10));
    expect(chanceAt(0, 5, 10, undefined, one)).toBeGreaterThan(chanceAt(0, 5, 10));
    // As shipped: 0.6 of the spread, 1.6 of the variance, sqrt(2.607² + 6.4), about 3.63.
    const shipped = Math.sqrt((0.6 * 4.345) ** 2 + 1.6 * 4);
    expect(chanceAt(5, 0, 10, undefined, { errors })).toBeCloseTo(
      1 / (1 + Math.exp(-5 / shipped)),
      12
    );
    // Widening reads the chance only: the margin's error is the shipped one's to the digit.
    const of = (key: string) => sweep.variants.find((variant) => variant.key === key)!;
    expect(of("curve-0.6-2.4").vsShipped?.squared?.by).toBe(0);
    expect(of("curve-0.6-2.4").logLoss).not.toBe(of("shipped").logLoss);
  });

  it("slices the same decided games for every setting, each game in one band of each slice", () => {
    expect(sweep.slices.map(({ key }) => key)).toEqual(MODEL_VARIANTS.map(({ key }) => key));
    const counts = (slices: (typeof sweep.slices)[number]) =>
      [slices.horizon, slices.thinnest, slices.apart].map((bands) =>
        bands.map(({ games }) => games)
      );
    for (const slices of sweep.slices) {
      for (const bands of counts(slices)) {
        expect(bands.reduce((sum, games) => sum + games, 0)).toBe(sweep.decided);
      }
      expect(counts(slices)).toEqual(counts(sweep.slices[0]!));
    }
    // Scored from 23 September to 10 October on fits of 1, 8 and 15 September: the 15th's first
    // games are 8 days on, the 1st's last 39 days on, and nothing is 49 days on.
    expect(sweep.slices[0]!.horizon.map(({ games }) => games > 0)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    // Each band's log loss beside the shipped model's on the same games: none for the shipped
    // itself, and for every other setting one paired reading of exactly the band's games.
    for (const bands of [sweep.slices[0]!.horizon, sweep.slices[0]!.thinnest]) {
      for (const band of bands) expect(band.vsShipped).toBeNull();
    }
    for (const slices of sweep.slices.slice(1)) {
      for (const band of [...slices.horizon, ...slices.thinnest, ...slices.apart]) {
        if (band.games < 2) continue;
        expect(band.vsShipped?.samples).toBe(band.games);
      }
    }
    // A setting that reads the very chances the shipped one does is level with it in every band.
    const twice = runModelSweep({
      ageGroups: groups,
      teams,
      games,
      year: 2027,
      today: "2026-10-31",
      variants: [
        MODEL_VARIANTS[0]!,
        { key: "again", why: "the shipped floor, named", floor: 0.08 },
      ],
    });
    const [once, again] = twice.slices;
    again!.horizon.forEach((band, at) => {
      expect(band.logLoss).toBe(once!.horizon[at]!.logLoss);
      if (band.games > 1) expect(band.vsShipped?.by).toBe(0);
    });
    // A widened curve says less for every favourite, in every band of days, and so scores
    // otherwise than the shipped curve on each band's games.
    const widened = sweep.slices.find(({ key }) => key === "curve-0.7-2.4")!;
    sweep.slices[0]!.horizon.forEach((band, at) => {
      if (band.games === 0) return;
      expect(widened.horizon[at]!.said).toBeLessThan(band.said);
      expect(widened.horizon[at]!.vsShipped?.by).not.toBe(0);
    });
  });

  it("reads the fit's own ratings for a matchup on `point`, which gives a thin club its discount back", () => {
    // Eight clubs of one strength play each other twice in August; a ninth plays two of them and
    // wins both by a run. Its rating stands on two games, so the board discounts it well below the
    // others'. From October it plays each of the eight: the shipped matchup reads it on the
    // discounted rating and `point` on the fit's own, so `point` gives it a better chance in
    // every game, and the margin each states differs by the discount.
    const even: ScoutTeam[] = Array.from({ length: 9 }, (_, at) => ({
      id: `E-${at}`,
      name: `Even ${at}`,
    }));
    const august: ScoutGame[] = [];
    for (let round = 0; round < 2; round += 1) {
      for (let a = 0; a < 8; a += 1) {
        for (let b = a + 1; b < 8; b += 1) {
          august.push({
            id: `e${round}-${a}-${b}`,
            ageGroupId: PAGE,
            teamAId: `E-${a}`,
            teamBId: `E-${b}`,
            teamAScore: 5 + ((a + b + round) % 3),
            teamBScore: 5 + ((a * b + round) % 3),
            date: `2026-08-${String(1 + ((a + b + round * 7) % 28)).padStart(2, "0")}`,
          });
        }
      }
    }
    const thin: ScoutGame[] = [0, 1].map((b) => ({
      id: `thin-${b}`,
      ageGroupId: PAGE,
      teamAId: "E-8",
      teamBId: `E-${b}`,
      teamAScore: 6,
      teamBScore: 5,
      date: `2026-08-2${b}`,
    }));
    const october: ScoutGame[] = Array.from({ length: 8 }, (_, b) => ({
      id: `oct-${b}`,
      ageGroupId: PAGE,
      teamAId: "E-8",
      teamBId: `E-${b}`,
      teamAScore: 4 + (b % 3),
      teamBScore: 5,
      date: `2026-10-${String(1 + b).padStart(2, "0")}`,
    }));
    const of = (keys: string[]) =>
      runModelSweep({
        ageGroups: groups,
        teams: even,
        games: [...august, ...thin, ...october],
        year: 2027,
        today: "2026-10-31",
        cuts: ["2026-09-01"],
        variants: MODEL_VARIANTS.filter(({ key }) => keys.includes(key)),
      });
    const both = of(["shipped", "point"]);
    // Eight scored, three of them drawn, so five decided.
    expect(both.games).toBe(8);
    expect(both.decided).toBe(5);
    const [shipped, point] = both.slices;
    // Every decided game is the thin club, as the thinner side, against a club of fourteen games:
    // none is in the band of two even errors, and all five sit half a run apart or more.
    const games = (slices: typeof shipped) => slices!.apart.map(({ games: count }) => count);
    expect(games(shipped)).toEqual(games(point));
    expect(games(shipped)[0]).toBe(0);
    expect(games(shipped)[1]).toBe(0);
    const total = (slices: typeof shipped, of: "said" | "won") =>
      slices!.apart.reduce((sum, band) => sum + (band.games > 0 ? band[of] * band.games : 0), 0);
    expect(total(point, "said")).toBeGreaterThan(total(shipped, "said"));
    // The same games and the same wins: only what was said moved.
    expect(total(point, "won")).toBe(total(shipped, "won"));
    expect(both.variants[1]!.vsShipped?.squared?.by).not.toBe(0);
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
