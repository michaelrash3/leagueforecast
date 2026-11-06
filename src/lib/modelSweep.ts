import { DEFAULT_SHRINKAGE } from "./powerRating";
import { dayInstant } from "./ratingRecency";
import { pairedImprovement, type PairedReading } from "./scoutBacktest";
import { isRankedAgeLevel } from "./teamRankings/seasons";
import {
  ageGroupYear,
  fitScoutYear,
  MATCHUP_MARGIN_CAP,
  MATCHUP_PROBABILITY_FLOOR,
  matchupOddsSpread,
  RATING_CAP,
  ratedMargin,
  ratingSpread,
  scoutFitRanks,
  scoutRatingGames,
  type AgeGroup,
  type ScoutFitTuning,
  type ScoutGame,
  type ScoutTeam,
  type ScoutYearFit,
} from "./teamRankings";

/*
 * The research sweep of Team Rankings' model as shipped (`scripts/modelSweep.ts`, PR 5): how well
 * the boards' win chances and margins forecast the games played after them, and whether the fit's
 * two settings, or the margin a matchup is stated to, would forecast them better.
 *
 * It repeats the method the counted level and the recency weights were measured by: the squad year
 * fitted as its boards would have been on each cut day, every later game between two clubs that fit
 * rated scored on the ratings the board showed (`ScoutYearFit.confident`), and every setting against
 * the shipped one game by game, with standard errors that read a club's games together
 * (`pairedImprovement`). Free of Node, so a test holds it to a made-up pool; the script only reads
 * a pool and prints.
 */

/** A setting tried against the shipped model: the fit's own, or the margin a matchup states. */
export type ModelVariant = {
  key: string;
  why: string;
  tuning?: ScoutFitTuning;
  /**
   * The nearest a matchup's chance comes to certain, either way, as `MATCHUP_PROBABILITY_FLOOR` is
   * shipped. Swept rather than the margin a chance is read to (`MATCHUP_MARGIN_CAP`, 14 runs): the
   * floor binds first, at about 9.6 runs at 10U and 11.6 at 18U, so no clamp past it moves a chance.
   */
  floor?: number;
  /**
   * The odds curve's width as a multiple of `matchupOddsSpread`, one as shipped: wider reads a
   * margin's chance nearer evens. Swept because the shipped model's calibration ran 1.5 to 2.6
   * points sure of the favourite from 60% to 85% on the cloud copy of 27 October 2026, which a
   * curve about a tenth wider would close. Like the floor, it leaves the fit alone.
   */
  spread?: number;
  /**
   * Which ratings the matchup is read from. "shown", as shipped and when left out: the ratings a
   * board shows, the fit's own less one standard error about the year's centre
   * (`ScoutYearFit.confident`), which is what ranks a thin record behind a proven one. "point": the
   * fit's own best guess (`pointRating` on a row). The discount was measured for which club a
   * table puts first, not for a chance: read into a matchup, it takes a thin club's whole discount
   * off its side of the margin, about a run between a four-game club and a forty-game one.
   */
  ratings?: "shown" | "point";
  /**
   * How much the two ratings' own uncertainty widens this matchup's curve: its width read as
   * `sqrt(width² + k × (errorA² + errorB²))`, each error the club's `ratingSpread` over its weighed
   * games, as the discount reads it. A logistic chance taken over a margin that is itself uncertain
   * by a variance v works out to about the same curve as wide as `sqrt(width² + πv/8)`, so k about
   * 0.4 is the plain reading; the shipped curve widens every matchup alike instead, a thin pair's
   * and a proven pair's. Left out, nothing is widened. Like the floor, it leaves the fit alone.
   */
  uncertainty?: number;
};

/** The shipped model first, then each setting moved on its own either way. */
export const MODEL_VARIANTS: readonly ModelVariant[] = [
  { key: "shipped", why: "the boards as they are" },
  {
    key: "ridge-0.75",
    why: "half the ridge's pull toward a club's starting level",
    tuning: { shrinkage: DEFAULT_SHRINKAGE * 0.5 },
  },
  {
    key: "ridge-1.125",
    why: "three quarters of it",
    tuning: { shrinkage: DEFAULT_SHRINKAGE * 0.75 },
  },
  { key: "ridge-2.25", why: "half again", tuning: { shrinkage: DEFAULT_SHRINKAGE * 1.5 } },
  { key: "ridge-3", why: "twice it", tuning: { shrinkage: DEFAULT_SHRINKAGE * 2 } },
  { key: "cap-8", why: "a game's margin capped at 8 runs in the fit", tuning: { cap: 8 } },
  { key: "cap-10", why: "at 10", tuning: { cap: 10 } },
  { key: "cap-14", why: "at 14", tuning: { cap: 14 } },
  { key: "cap-16", why: "at 16", tuning: { cap: 16 } },
  { key: "floor-0.02", why: "a chance allowed to 98%", floor: 0.02 },
  { key: "floor-0.05", why: "to 95%", floor: 0.05 },
  { key: "floor-0.12", why: "held to 88%", floor: 0.12 },
  { key: "spread-0.95", why: "the odds curve a twentieth narrower", spread: 0.95 },
  { key: "spread-1.05", why: "a twentieth wider", spread: 1.05 },
  { key: "spread-1.1", why: "a tenth wider", spread: 1.1 },
  { key: "spread-1.15", why: "three twentieths wider", spread: 1.15 },
  { key: "spread-1.2", why: "a fifth wider", spread: 1.2 },
  { key: "spread-1.3", why: "three tenths wider", spread: 1.3 },
  {
    key: "point",
    why: "the matchup read from the fit's own ratings, not the shown",
    ratings: "point",
  },
  {
    key: "widen-0.2",
    why: "the curve widened by a fifth of the two ratings' variance, matchup by matchup",
    uncertainty: 0.2,
  },
  { key: "widen-0.4", why: "by 0.4 of it, about π/8", uncertainty: 0.4 },
  { key: "widen-0.8", why: "by 0.8 of it", uncertainty: 0.8 },
  { key: "widen-1.6", why: "by 1.6 of it", uncertainty: 1.6 },
  {
    key: "widen-0.4-0.95",
    why: "by 0.4 of it, about a curve a twentieth narrower",
    uncertainty: 0.4,
    spread: 0.95,
  },
  {
    key: "widen-0.4-0.9",
    why: "by 0.4 of it, about a tenth narrower",
    uncertainty: 0.4,
    spread: 0.9,
  },
  /*
   * The first read of the cloud copy with these (6 November 2026) found the shipped curve too sure
   * of the favourite where the thinner club stood on under four weighed games and not sure enough
   * where it stood on more: 1.0 point too sure, then 1.7 and 6.1 not sure enough. A curve that
   * closes both is much narrower about a proven pair and widens fast as the evidence thins, so
   * the base is narrowed by a fifth to two fifths and the widening read at one to over three times
   * the two ratings' variance.
   */
  ...[0.6, 0.7, 0.8].flatMap((base) =>
    [1, 1.6, 2.4, 3.2].map((k): ModelVariant => ({
      key: `widen-${k}-${base}`,
      why: `by ${k} of it, about a curve ${base} as wide`,
      uncertainty: k,
      spread: base,
    }))
  ),
];

/** The cut days the sweeps of this pool have read, and the day later games are scored from. */
export const MODEL_CUTS = ["2026-09-01", "2026-09-08", "2026-09-15"];
export const MODEL_SCORE_FROM = "2026-09-23";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * The first club's chance against the second, as `predictMatchup` reads it, held to `floor` either
 * way rather than `MATCHUP_PROBABILITY_FLOOR`, on a curve `spread` times as wide, and wider again by
 * `variance` (runs², `ModelVariant.uncertainty`): the same at the shipped floor, a spread of one and
 * no variance, to the digit.
 */
export const chanceAt = (
  ratingA: number,
  ratingB: number,
  ageLevel: number | undefined,
  floor = MATCHUP_PROBABILITY_FLOOR,
  spread = 1,
  variance = 0
): number => {
  const margin = clamp(ratingA - ratingB, -MATCHUP_MARGIN_CAP, MATCHUP_MARGIN_CAP);
  const base = matchupOddsSpread(ageLevel) * spread;
  const width = variance > 0 ? Math.sqrt(base * base + variance) : base;
  return clamp(1 / (1 + Math.exp(-margin / width)), floor, 1 - floor);
};

/** How far a club's rating on a fit could be off, in runs: what the shown rating's discount reads. */
const ratingErrorOn = (fit: ScoutYearFit, id: string) =>
  ratingSpread(fit.effective.get(id) ?? 0, fit.adjusted.residualScale);

/**
 * Whether one board lists both sides of a game on a fit, as `rowsOfYearFit` cuts a board from a fit: neither
 * a club known only by name nor a slot ("standIn"), both at home on the same ranked page, or else
 * on different pages ("apart"). A forecast is only ever stated between two rows of one board (Next
 * up, the scouting report and Compare all read one board's rows), so only "listed" games are scored.
 */
const boardPlacer = (fit: ScoutYearFit) => {
  const listed = new Set(
    fit.nodes.filter((team) => !team.placeholder && !team.nameOnly).map((team) => team.id)
  );
  return (game: ScoutGame): "listed" | "apart" | "standIn" => {
    if (!listed.has(game.teamAId) || !listed.has(game.teamBId)) return "standIn";
    const a = fit.homeLevels.get(game.teamAId);
    const b = fit.homeLevels.get(game.teamBId);
    return a === b && isRankedAgeLevel(a) ? "listed" : "apart";
  };
};

/**
 * A game's stated margin and the first club's chance on a fit, as a board's matchup reads them
 * (`predictMatchup` on the two shown ratings): the margin held to `MATCHUP_MARGIN_CAP` either way,
 * so a gap between two ratings wider than any board would say is not scored as if it had been said.
 * Only for two clubs one board lists (`boardPlacer`): no other matchup is ever stated, and the sweep
 * leaves those games out rather than score a forecast nobody was shown.
 */
const predicted = (fit: ScoutYearFit, game: ScoutGame, variant: ModelVariant) => {
  const own = (id: string) => fit.adjusted.ratings.get(id) ?? 0;
  const read =
    variant.ratings === "point"
      ? own
      : (id: string) => fit.confident(own(id), fit.effective.get(id) ?? 0);
  const a = read(game.teamAId);
  const b = read(game.teamBId);
  const level = fit.homeLevels.get(game.teamAId) ?? fit.homeLevels.get(game.teamBId);
  const variance = variant.uncertainty
    ? variant.uncertainty *
      (ratingErrorOn(fit, game.teamAId) ** 2 + ratingErrorOn(fit, game.teamBId) ** 2)
    : 0;
  return {
    margin: clamp(a - b, -MATCHUP_MARGIN_CAP, MATCHUP_MARGIN_CAP),
    win: chanceAt(a, b, level, variant.floor, variant.spread, variance),
  };
};

/** One band of the shipped model's calibration: games whose favourite it gave this much. */
export type CalibrationBand = {
  from: number;
  to: number;
  games: number;
  /** The mean chance it gave the favourite, and the share of these games the favourite won. */
  said: number;
  won: number;
};

/**
 * One band of a slice of the decided games, read from one side: the mean chance that side was
 * given and how often it won (a side said more than it won is a side the model was too sure of),
 * and the band's log loss, lower than the shipped model's on the same games by `vsShipped`, with a
 * standard error that reads a club's games together (`pairedImprovement`); null for the shipped.
 */
export type SliceBand = {
  label: string;
  games: number;
  said: number;
  won: number;
  logLoss: number;
  vsShipped: PairedReading | null;
};

/**
 * Where a setting's chances go wrong, in three cuts of the same decided games, a band holding the
 * same games for every setting (read off the shipped fit, never the setting's own):
 * - `horizon`, from the favourite's side, by days from the cut to the game. The boards are rebuilt
 *   every night, so the forecast a member reads is mostly for a game days away, while the sweep
 *   scores games from eight days to two months after its cuts, over which a rating drifts.
 * - `thinnest`, from the favourite's side, by the weighed games (`effectiveGames`) behind the
 *   thinner of the two clubs.
 * - `apart`, from the thinner club's side, by how far apart the two ratings' errors are: a thinner
 *   club that wins more often than it is given is one the matchup under-rates.
 */
export type VariantSlices = {
  key: string;
  horizon: SliceBand[];
  thinnest: SliceBand[];
  apart: SliceBand[];
};

type Band = { label: string; below: number };
export const HORIZON_BANDS: readonly Band[] = [
  { label: "under 21 days", below: 21 },
  { label: "21-34", below: 35 },
  { label: "35-48", below: 49 },
  { label: "49+", below: Number.POSITIVE_INFINITY },
];
export const THINNEST_BANDS: readonly Band[] = [
  { label: "under 2 games", below: 2 },
  { label: "2-4", below: 4 },
  { label: "4-8", below: 8 },
  { label: "8+", below: Number.POSITIVE_INFINITY },
];
export const APART_BANDS: readonly Band[] = [
  { label: "under 0.25 runs", below: 0.25 },
  { label: "0.25-0.5", below: 0.5 },
  { label: "0.5-1", below: 1 },
  { label: "1+", below: Number.POSITIVE_INFINITY },
];
const bandOf = (bands: readonly Band[], value: number) => {
  const at = bands.findIndex(({ below }) => value < below);
  return at < 0 ? bands.length - 1 : at;
};

export type VariantReading = {
  key: string;
  why: string;
  /** Over the decided games: mean log loss and Brier score of the first club's chance. */
  logLoss: number;
  brier: number;
  /**
   * Over every scored game: the squared error of the margin as a board states it (held to
   * `MATCHUP_MARGIN_CAP`), the result capped at `RATING_CAP`.
   */
  squared: number;
  /** Lower than the shipped model's, game by game, with a standard error by club; null for it. */
  vsShipped: {
    logLoss: PairedReading | null;
    brier: PairedReading | null;
    squared: PairedReading | null;
  } | null;
  /** Seconds its fits took, over the cuts. */
  seconds: number;
};

export type ModelSweep = {
  year: number | undefined;
  cuts: {
    cut: string;
    trained: number;
    scored: number;
    decided: number;
    crossAge: number;
    standIns: number;
  }[];
  /** Every scored game, and the decided ones the chances are scored on. */
  games: number;
  /**
   * Later games between two rated clubs that no one board lists together, left out of every
   * reading, over the cuts: two clubs at home on different pages (across ages), and a club known
   * only by name or a bracket slot on a side, which no board lists at all.
   */
  crossAge: number;
  standIns: number;
  decided: number;
  variants: VariantReading[];
  /** The shipped model's chance for the favourite, in bands of five points, and how often it won. */
  calibration: CalibrationBand[];
  /** Every setting's chances against what happened, in the same slices of the decided games. */
  slices: VariantSlices[];
};

export type ModelSweepInput = {
  ageGroups: AgeGroup[];
  teams: ScoutTeam[];
  games: ScoutGame[];
  year: number;
  cuts?: readonly string[];
  scoreFrom?: string;
  /** The day the pool is judged on, so a game dated after it is left out of everything. */
  today: string;
  variants?: readonly ModelVariant[];
  now?: () => number;
};

const mean = (values: Float32Array | readonly number[]) => {
  let sum = 0;
  for (const value of values) sum += value;
  return values.length === 0 ? Number.NaN : sum / values.length;
};

/** The sweep: every variant fitted at every cut and scored on the games after it. */
export const runModelSweep = (input: ModelSweepInput): ModelSweep => {
  const { ageGroups, teams, games, year, today } = input;
  const cuts = input.cuts ?? MODEL_CUTS;
  const variants = input.variants ?? MODEL_VARIANTS;
  const now = input.now ?? Date.now;
  const page = ageGroups.find(
    (group) => ageGroupYear(group) === year && scoutFitRanks(group.id, ageGroups)
  );
  const empty: ModelSweep = {
    year,
    cuts: [],
    games: 0,
    crossAge: 0,
    standIns: 0,
    decided: 0,
    variants: [],
    calibration: [],
    slices: [],
  };
  if (!page) return empty;
  const fromAt = dayInstant(input.scoreFrom ?? MODEL_SCORE_FROM);
  const later = scoutRatingGames(page.id, teams, games, ageGroups, undefined, today)
    .map((entry) => ({ ...entry, day: dayInstant(entry.game.date) }))
    .filter(({ day }) => day >= fromAt);

  const sideIndex = new Map<string, number>();
  const sideOf = (id: string) => {
    const known = sideIndex.get(id);
    if (known !== undefined) return known;
    sideIndex.set(id, sideIndex.size);
    return sideIndex.size - 1;
  };
  // Per variant: each scored game's squared error, and each decided game's log loss and Brier.
  const piles = variants.map(() => ({
    squared: [] as number[],
    logLoss: [] as number[],
    brier: [] as number[],
    seconds: 0,
  }));
  // Per variant, per slice and band: the games, the chances said to the side read, and its wins.
  const tallies = variants.map(() =>
    [HORIZON_BANDS, THINNEST_BANDS, APART_BANDS].map((bands) =>
      bands.map(() => ({ games: 0, said: 0, won: 0 }))
    )
  );
  const sides: number[] = [];
  const decidedSides: number[] = [];
  // Each decided game's band in each slice, in the order every setting's log losses are pushed.
  const decidedBands: Array<readonly [number, number, number]> = [];
  const shippedChances: Array<{ win: number; won: boolean }> = [];
  const cutReadings: ModelSweep["cuts"] = [];
  // Each distinct fit once a cut: the floors share the shipped fit.
  const tuningKey = (variant: ModelVariant) =>
    `${variant.tuning?.cap ?? ""}|${variant.tuning?.shrinkage ?? ""}`;

  for (const cut of cuts) {
    const trained = scoutRatingGames(page.id, teams, games, ageGroups, undefined, cut);
    const fits = new Map<string, ScoutYearFit>();
    const fitOf = (variant: ModelVariant, at: number) => {
      const key = tuningKey(variant);
      const known = fits.get(key);
      if (known) return known;
      const started = now();
      const fit = fitScoutYear(year, teams, games, trained, ageGroups, variant.tuning ?? {});
      piles[at]!.seconds += (now() - started) / 1000;
      fits.set(key, fit);
      return fit;
    };
    const shipped = fitOf(variants[0]!, 0);
    const rated = later.filter(
      ({ game }) =>
        (shipped.adjusted.games.get(game.teamAId) ?? 0) > 0 &&
        (shipped.adjusted.games.get(game.teamBId) ?? 0) > 0
    );
    const placeOf = boardPlacer(shipped);
    const placed = rated.map((entry) => ({ ...entry, on: placeOf(entry.game) }));
    const scored = placed.filter(({ on }) => on === "listed");
    let decided = 0;
    for (const { game } of scored) {
      const pair = [sideOf(game.teamAId), sideOf(game.teamBId)] as const;
      sides.push(...pair);
      if ((ratedMargin(game) ?? 0) !== 0) {
        decidedSides.push(...pair);
        decided += 1;
      }
    }
    cutReadings.push({
      cut,
      trained: trained.length,
      scored: scored.length,
      decided,
      crossAge: placed.filter(({ on }) => on === "apart").length,
      standIns: placed.filter(({ on }) => on === "standIn").length,
    });
    // Each game's place in the slices, off the shipped fit, so a band holds the same games for all.
    const cutAt = dayInstant(cut);
    const placesInSlices = scored.map(({ game, day }) => {
      const errorA = ratingErrorOn(shipped, game.teamAId);
      const errorB = ratingErrorOn(shipped, game.teamBId);
      return {
        horizon: bandOf(HORIZON_BANDS, (day - cutAt) / 86_400_000),
        thinnest: bandOf(
          THINNEST_BANDS,
          Math.min(
            shipped.effective.get(game.teamAId) ?? 0,
            shipped.effective.get(game.teamBId) ?? 0
          )
        ),
        apart: bandOf(APART_BANDS, Math.abs(errorA - errorB)),
        thinnerIsA: errorA >= errorB,
      };
    });
    variants.forEach((variant, at) => {
      const fit = fitOf(variant, at);
      const pile = piles[at]!;
      const [byHorizon, byThinnest, byApart] = tallies[at]!;
      scored.forEach(({ game }, index) => {
        const margin = clamp(ratedMargin(game) ?? 0, -RATING_CAP, RATING_CAP);
        const guess = predicted(fit, game, variant);
        pile.squared.push((guess.margin - margin) ** 2);
        if (margin === 0) return;
        const won = margin > 0;
        const chance = clamp(won ? guess.win : 1 - guess.win, 1e-9, 1);
        pile.logLoss.push(-Math.log(chance));
        pile.brier.push((guess.win - (won ? 1 : 0)) ** 2);
        const place = placesInSlices[index]!;
        if (at === 0) {
          shippedChances.push({ win: guess.win, won });
          decidedBands.push([place.horizon, place.thinnest, place.apart]);
        }
        const favouriteIsA = guess.win >= 0.5;
        const favourite = {
          said: favouriteIsA ? guess.win : 1 - guess.win,
          won: favouriteIsA === won ? 1 : 0,
        };
        const tally = (
          band: { games: number; said: number; won: number },
          said: number,
          wins: number
        ) => {
          band.games += 1;
          band.said += said;
          band.won += wins;
        };
        tally(byHorizon![place.horizon]!, favourite.said, favourite.won);
        tally(byThinnest![place.thinnest]!, favourite.said, favourite.won);
        tally(
          byApart![place.apart]!,
          place.thinnerIsA ? guess.win : 1 - guess.win,
          place.thinnerIsA === won ? 1 : 0
        );
      });
    });
  }

  const sideArray = Uint32Array.from(sides);
  const decidedArray = Uint32Array.from(decidedSides);
  const reference = (values: number[], over: Uint32Array) => ({
    errors: Float32Array.from(values),
    sides: over,
  });
  const shippedPile = piles[0]!;
  const readings: VariantReading[] = variants.map((variant, at) => {
    const pile = piles[at]!;
    const vs =
      at === 0
        ? null
        : {
            logLoss: pairedImprovement(
              { errors: Float32Array.from(pile.logLoss) },
              reference(shippedPile.logLoss, decidedArray),
              false
            ),
            brier: pairedImprovement(
              { errors: Float32Array.from(pile.brier) },
              reference(shippedPile.brier, decidedArray),
              false
            ),
            squared: pairedImprovement(
              { errors: Float32Array.from(pile.squared) },
              reference(shippedPile.squared, sideArray),
              false
            ),
          };
    return {
      key: variant.key,
      why: variant.why,
      logLoss: mean(pile.logLoss),
      brier: mean(pile.brier),
      squared: mean(pile.squared),
      vsShipped: vs,
      seconds: pile.seconds,
    };
  });

  // Read from the favourite's side, so a band says what a chance of that size is worth.
  const calibration: CalibrationBand[] = [];
  for (let from = 0.5; from < 1; from += 0.05) {
    const to = Math.min(1, from + 0.05);
    const band = shippedChances
      .map(({ win, won }) => (win >= 0.5 ? { said: win, won } : { said: 1 - win, won: !won }))
      .filter(({ said }) => said >= from - 1e-12 && (said < to - 1e-12 || to === 1));
    calibration.push({
      from,
      to,
      games: band.length,
      said: mean(band.map(({ said }) => said)),
      won: mean(band.map(({ won }) => (won ? 1 : 0))),
    });
  }

  // The decided games of each band of each slice, by their place among every setting's log losses.
  const families = [HORIZON_BANDS, THINNEST_BANDS, APART_BANDS] as const;
  const inBand = families.map((bands, family) =>
    bands.map((_, band) => {
      const games: number[] = [];
      decidedBands.forEach((place, at) => {
        if (place[family] === band) games.push(at);
      });
      return Uint32Array.from(games);
    })
  );
  const bandReading = (pile: number[], games: Uint32Array, own: boolean) => {
    const errors = Float32Array.from(games, (at) => pile[at]!);
    const logLoss = mean(errors);
    if (own) return { logLoss, vsShipped: null };
    const bandSides = new Uint32Array(games.length * 2);
    games.forEach((at, index) => {
      bandSides[index * 2] = decidedArray[at * 2]!;
      bandSides[index * 2 + 1] = decidedArray[at * 2 + 1]!;
    });
    const vsShipped = pairedImprovement(
      { errors },
      { errors: Float32Array.from(games, (at) => shippedPile.logLoss[at]!), sides: bandSides },
      false
    );
    return { logLoss, vsShipped };
  };
  const slices: VariantSlices[] = variants.map((variant, at) => {
    const counted = tallies[at]!;
    const [horizon, thinnest, apart] = families.map((bands, family) =>
      bands.map(({ label }, band): SliceBand => {
        const { games, said, won } = counted[family]![band]!;
        return {
          label,
          games,
          said: games > 0 ? said / games : Number.NaN,
          won: games > 0 ? won / games : Number.NaN,
          ...bandReading(piles[at]!.logLoss, inBand[family]![band]!, at === 0),
        };
      })
    );
    return { key: variant.key, horizon: horizon!, thinnest: thinnest!, apart: apart! };
  });

  return {
    year,
    cuts: cutReadings,
    games: shippedPile.squared.length,
    crossAge: cutReadings.reduce((sum, cut) => sum + cut.crossAge, 0),
    standIns: cutReadings.reduce((sum, cut) => sum + cut.standIns, 0),
    decided: shippedPile.logLoss.length,
    variants: readings,
    calibration,
    slices,
  };
};
