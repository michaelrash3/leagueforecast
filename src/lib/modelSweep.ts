import { DEFAULT_SHRINKAGE } from "./powerRating";
import { dayInstant } from "./ratingRecency";
import { pairedImprovement, type PairedReading } from "./scoutBacktest";
import { isRankedAgeLevel } from "./teamRankings/seasons";
import { opponentWeb, type OpponentWeb } from "./teamRankings/opponentWeb";
import {
  ageGroupYear,
  fitScoutYear,
  MATCHUP_MARGIN_CAP,
  MATCHUP_ODDS_ERROR_WEIGHT,
  MATCHUP_ODDS_PROVEN_SHARE,
  MATCHUP_PROBABILITY_FLOOR,
  oddsWidthWith,
  RATING_CAP,
  ratedMargin,
  ratingErrorOf,
  scoutFitRanks,
  scoutRatingGames,
  type AgeGroup,
  type MatchupErrors,
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
   * How wide the odds curve is about two proven clubs, as a share of `matchupOddsSpread`
   * (`MATCHUP_ODDS_PROVEN_SHARE` as shipped), and how much the two clubs' errors widen it from
   * there, as the weight of their variance (`MATCHUP_ODDS_ERROR_WEIGHT`): the curve's width read as
   * `sqrt((share × spread)² + weight × (errorA² + errorB²))`, each error the club's `ratingSpread`
   * over its weighed games (`oddsWidthWith`). A share of one and no weight is the single curve of a
   * matchup's age that every matchup read until 6 November 2026. Like the floor, neither moves the
   * fit.
   */
  share?: number;
  weight?: number;
  /**
   * Which ratings the matchup is read from. "shown", as shipped and when left out: the ratings a
   * board shows, the fit's own less one standard error about the year's centre
   * (`ScoutYearFit.confident`), which is what ranks a thin record behind a proven one. "point": the
   * fit's own best guess (`pointRating` on a row). The discount was measured for which club a
   * table puts first, not for a chance: read into a matchup, it takes a thin club's whole discount
   * off its side of the margin, about a run between a four-game club and a forty-game one.
   */
  ratings?: "shown" | "point";
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
  /*
   * Weaker still. On the boards of October and November 2026 the ridge at half its pull beat the
   * shipped one clearly (log loss 0.0061 and 0.0053 lower), and three quarters beat it by about
   * half as much, so the best ridge then lay at half or below; on September's it lay between three
   * quarters and the shipped one. Each value here is the ridge itself, not a share of
   * `DEFAULT_SHRINKAGE`, so a key names its ridge whatever the default is.
   */
  { key: "ridge-0.15", why: "a tenth of the ridge's pull", tuning: { shrinkage: 0.15 } },
  { key: "ridge-0.25", why: "a sixth of it", tuning: { shrinkage: 0.25 } },
  { key: "ridge-0.375", why: "a quarter of it", tuning: { shrinkage: 0.375 } },
  { key: "ridge-0.5", why: "a third of it", tuning: { shrinkage: 0.5 } },
  { key: "ridge-1", why: "two thirds of it", tuning: { shrinkage: 1 } },
  { key: "cap-8", why: "a game's margin capped at 8 runs in the fit", tuning: { cap: 8 } },
  { key: "cap-10", why: "at 10", tuning: { cap: 10 } },
  { key: "cap-14", why: "at 14", tuning: { cap: 14 } },
  { key: "cap-16", why: "at 16", tuning: { cap: 16 } },
  { key: "floor-0.02", why: "a chance allowed to 98%", floor: 0.02 },
  { key: "floor-0.05", why: "to 95%", floor: 0.05 },
  { key: "floor-0.12", why: "held to 88%", floor: 0.12 },
  {
    key: "single",
    why: "the single curve of a matchup's age, as every matchup read it until 6 November 2026",
    share: 1,
    weight: 0,
  },
  { key: "single-0.95", why: "the single curve a twentieth narrower", share: 0.95, weight: 0 },
  { key: "single-1.05", why: "a twentieth wider", share: 1.05, weight: 0 },
  {
    key: "point",
    why: "the matchup read from the fit's own ratings, not the shown",
    ratings: "point",
  },
  /*
   * About the shipped curve, a share of 0.6 and a weight of 1.6, chosen of twelve on the cloud
   * copy of 6 November 2026 (`matchupOddsWidth`): a tenth of the spread either way, and a weight
   * of 1 and 2.4.
   */
  ...[0.5, 0.6, 0.7].flatMap((share) =>
    [1, 1.6, 2.4]
      .filter(
        (weight) => share !== MATCHUP_ODDS_PROVEN_SHARE || weight !== MATCHUP_ODDS_ERROR_WEIGHT
      )
      .map((weight): ModelVariant => ({
        key: `curve-${share}-${weight}`,
        why: `${share} of the spread about a proven pair, ${weight} of the two errors' variance`,
        share,
        weight,
      }))
  ),
  /*
   * A weaker ridge spreads the ratings and widens each club's error, and the curve reads both, so
   * the curve chosen on the shipped ridge need not suit another. Three ridges, each on the nine
   * curves about the shipped one (its own included, so the ridge alone has rows in the slices),
   * and with the floor at 2% and 5%.
   */
  ...[0.5, 0.75, 1].flatMap((shrinkage): ModelVariant[] => [
    ...[0.5, 0.6, 0.7].flatMap((share) =>
      [1, 1.6, 2.4].map((weight): ModelVariant => ({
        key: `r${shrinkage}-c${share}-${weight}`,
        why: `the ridge at ${shrinkage}, on ${share} of the spread and ${weight} of the variance`,
        tuning: { shrinkage },
        share,
        weight,
      }))
    ),
    ...[0.02, 0.05].map((floor): ModelVariant => ({
      key: `r${shrinkage}-f${floor}`,
      why: `the ridge at ${shrinkage}, a chance allowed to ${Math.round(100 - floor * 100)}%`,
      tuning: { shrinkage },
      floor,
    })),
  ]),
  /*
   * The second read: one ridge for the fit and the evidence alike (`ScoutFitTuning.evidence`), as
   * the app would ship it, since a board carries one ridge (`BoardFit.shrink`): each club's weighed
   * games, its discount and its error read it too. On the curves the first read found best with a
   * weaker ridge, a share of 0.6 and 0.7 and a weight of 1.6, 2.4 and 3.2 (2.4, the edge of its
   * grid, was best on September's boards), and with the floor at 2%. Beside them the fit's ridge
   * alone at 0.5 and 0.75 at a weight of 3.2.
   */
  ...[0.375, 0.5, 0.75, 1].flatMap((shrinkage): ModelVariant[] => [
    ...[0.6, 0.7].flatMap((share) =>
      [1.6, 2.4, 3.2].map((weight): ModelVariant => ({
        key: `e${shrinkage}-c${share}-${weight}`,
        why: `one ridge of ${shrinkage}, on ${share} of the spread and ${weight} of the variance`,
        tuning: { shrinkage, evidence: shrinkage },
        share,
        weight,
      }))
    ),
    {
      key: `e${shrinkage}-f0.02`,
      why: `one ridge of ${shrinkage}, a chance allowed to 98%`,
      tuning: { shrinkage, evidence: shrinkage },
      floor: 0.02,
    },
  ]),
  ...[0.5, 0.75].flatMap((shrinkage) =>
    [0.6, 0.7].map((share): ModelVariant => ({
      key: `r${shrinkage}-c${share}-3.2`,
      why: `the ridge at ${shrinkage}, on ${share} of the spread and 3.2 of the variance`,
      tuning: { shrinkage },
      share,
      weight: 3.2,
    }))
  ),
  /*
   * The third read: the discount beside the ridge. A weaker ridge lets a short record's fitted
   * rating run further than one standard error holds back, so a 3-0 club of big wins can rank
   * above an 11-1 club, where the table has put what is proved first. Each of these reads the
   * shown rating more standard errors below the fit's (`ScoutFitTuning.standardErrors`), and every
   * setting's boards say how many of their top places short records hold (`thinAtTheTop`).
   */
  ...[1.25, 1.5, 2].map((errors): ModelVariant => ({
    key: `e0.5-c0.6-2.4-se${errors}`,
    why: `one ridge of 0.5 on 0.6/2.4, the shown rating ${errors} errors below the fit's`,
    tuning: { shrinkage: 0.5, evidence: 0.5, standardErrors: errors },
    share: 0.6,
    weight: 2.4,
  })),
  {
    key: "e0.75-c0.6-2.4-se1.25",
    why: "one ridge of 0.75 on 0.6/2.4, the shown rating 1.25 errors below the fit's",
    tuning: { shrinkage: 0.75, evidence: 0.75, standardErrors: 1.25 },
    share: 0.6,
    weight: 2.4,
  },
];

/** The cut days the sweeps of this pool have read, and the day later games are scored from. */
export const MODEL_CUTS = ["2026-09-01", "2026-09-08", "2026-09-15"];
export const MODEL_SCORE_FROM = "2026-09-23";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The middle value of a list, the mean of the two middle ones for an even count; 0 for none. */
const medianOf = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1
    ? (sorted[half] ?? 0)
    : ((sorted[half - 1] ?? 0) + (sorted[half] ?? 0)) / 2;
};

/**
 * The first club's chance against the second, as `predictMatchup` reads it, held to `floor` either
 * way rather than `MATCHUP_PROBABILITY_FLOOR`, on the curve `share` and `weight` make of the two
 * clubs' errors (`oddsWidthWith`), the shipped share and weight where left out: the same as
 * `predictMatchup` at the shipped floor, share and weight, to the digit, and its single curve of
 * the age where no errors are given.
 */
export const chanceAt = (
  ratingA: number,
  ratingB: number,
  ageLevel: number | undefined,
  floor = MATCHUP_PROBABILITY_FLOOR,
  curve: { share?: number; weight?: number; errors?: MatchupErrors } = {}
): number => {
  const margin = clamp(ratingA - ratingB, -MATCHUP_MARGIN_CAP, MATCHUP_MARGIN_CAP);
  const width = oddsWidthWith(
    ageLevel,
    curve.errors,
    curve.share ?? MATCHUP_ODDS_PROVEN_SHARE,
    curve.weight ?? MATCHUP_ODDS_ERROR_WEIGHT
  );
  return clamp(1 / (1 + Math.exp(-margin / width)), floor, 1 - floor);
};

/**
 * How far a club's rating on a fit could be off, in runs: what the shown rating's discount reads,
 * with the ridge the setting reads the evidence with (`ScoutFitTuning.evidence`), the default's
 * when it names none.
 */
const ratingErrorOn = (fit: ScoutYearFit, id: string, evidence: number = DEFAULT_SHRINKAGE) =>
  ratingErrorOf(fit.effective.get(id) ?? 0, fit.adjusted.residualScale, evidence);

/** The places at the top of each ranked board the sweep counts, and the record a club is thin under. */
export const BOARD_TOP = 25;
export const THIN_RECORD_GAMES = 4;

/**
 * Of the first `BOARD_TOP` places on each ranked board a fit makes, ranked as a board ranks them
 * (`rankRows`: the clubs whose web of games reaches the line first, each by the rating a board
 * shows), how many there are and how many clubs with fewer than `THIN_RECORD_GAMES` games on their
 * record hold: what the discount keeps a short record from, as a member reads a table. The web is
 * the cut's (`opponentWeb`), since it is who played whom, not any rating.
 */
const thinAtTheTop = (fit: ScoutYearFit, web: OpponentWeb) => {
  const boards = new Map<number, Array<{ short: boolean; shown: number; games: number }>>();
  for (const team of fit.nodes) {
    if (team.placeholder || team.nameOnly) continue;
    const level = fit.homeLevels.get(team.id);
    if (level === undefined || !isRankedAgeLevel(level)) continue;
    const record = fit.records.get(team.id);
    const entry = {
      short: !web.reachesLine(team.id),
      shown: fit.confident(fit.adjusted.ratings.get(team.id) ?? 0, fit.effective.get(team.id) ?? 0),
      games: record ? record.wins + record.losses + record.ties : 0,
    };
    const board = boards.get(level);
    if (board) board.push(entry);
    else boards.set(level, [entry]);
  }
  let places = 0;
  let thin = 0;
  for (const board of boards.values()) {
    board.sort((a, b) => Number(a.short) - Number(b.short) || b.shown - a.shown);
    for (const { games } of board.slice(0, BOARD_TOP)) {
      places += 1;
      if (games < THIN_RECORD_GAMES) thin += 1;
    }
  }
  return { places, thin };
};

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
  const evidence = variant.tuning?.evidence;
  const errors = {
    a: ratingErrorOn(fit, game.teamAId, evidence),
    b: ratingErrorOn(fit, game.teamBId, evidence),
  };
  return {
    margin: clamp(a - b, -MATCHUP_MARGIN_CAP, MATCHUP_MARGIN_CAP),
    win: chanceAt(a, b, level, variant.floor, {
      ...(variant.share === undefined ? {} : { share: variant.share }),
      ...(variant.weight === undefined ? {} : { weight: variant.weight }),
      errors,
    }),
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
  /**
   * Over the cuts, the first `BOARD_TOP` places of each ranked board as the fit ranks it, and how
   * many of them clubs of fewer than `THIN_RECORD_GAMES` games on their record hold (`thinAtTheTop`).
   */
  top: { places: number; thin: number };
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
    /** The shipped fit's residual scale, in runs, which a row's error reads (`ratingErrorOf`). */
    residualScale: number;
    /**
     * The median club's weighed games on the shipped fit (`effectiveGames`), over the clubs a board
     * could list: how much the cut's clubs had played, which the ridge best for a cut follows.
     */
    medianGames: number;
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
    topPlaces: 0,
    topThin: 0,
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
    `${variant.tuning?.cap ?? ""}|${variant.tuning?.shrinkage ?? ""}|${variant.tuning?.evidence ?? ""}|${variant.tuning?.standardErrors ?? ""}`;

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
      residualScale: shipped.adjusted.residualScale,
      medianGames: medianOf(
        shipped.nodes
          .filter((team) => !team.placeholder && !team.nameOnly)
          .map((team) => shipped.effective.get(team.id) ?? 0)
      ),
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
    // The cut's web of games, which every setting's boards share: it is who played whom.
    const web = opponentWeb(trained.map(({ game }) => [game.teamAId, game.teamBId] as const));
    const tops = new Map<string, { places: number; thin: number }>();
    variants.forEach((variant, at) => {
      const fit = fitOf(variant, at);
      const pile = piles[at]!;
      const fitKey = tuningKey(variant);
      let top = tops.get(fitKey);
      if (!top) {
        top = thinAtTheTop(fit, web);
        tops.set(fitKey, top);
      }
      pile.topPlaces += top.places;
      pile.topThin += top.thin;
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
      top: { places: pile.topPlaces, thin: pile.topThin },
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
