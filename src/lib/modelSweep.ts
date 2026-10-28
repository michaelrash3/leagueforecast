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
  scoutFitRanks,
  scoutRatingGames,
  type AgeGroup,
  type RatedScoutGame,
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
   * Games left out of what the fit is trained on, by id, read off the games trained at each cut:
   * the stand-in levers (`standInLevers.ts`) are tried this way, the games scored left as they are,
   * so a lever is judged on the same games as the boards it would replace.
   */
  leaveOut?: (
    teams: readonly ScoutTeam[],
    trained: readonly RatedScoutGame[]
  ) => ReadonlySet<string>;
  /**
   * Clubs known only by name filed onto a pulled club for the fit, stand-in id to club id: every
   * game the fit reads, trained or not, reads the club where it read the stand-in, and a game the
   * club would then play against itself is left out. The namesake levers (`namesakeFilings`) are
   * tried this way: whether a name is its namesake's cannot be read off the name, but boards trained
   * on the wrong club forecast that club's later games worse.
   */
  refile?: ReadonlyMap<string, string>;
};

/** Games read with each stand-in `onto` names as its club, any that club would play itself left out. */
const refiledGames = <Entry>(
  entries: readonly Entry[],
  gameOf: (entry: Entry) => ScoutGame,
  withGame: (entry: Entry, game: ScoutGame) => Entry,
  onto: ReadonlyMap<string, string>
): Entry[] =>
  entries.flatMap((entry) => {
    const game = gameOf(entry);
    const teamAId = onto.get(game.teamAId) ?? game.teamAId;
    const teamBId = onto.get(game.teamBId) ?? game.teamBId;
    if (teamAId === game.teamAId && teamBId === game.teamBId) return [entry];
    return teamAId === teamBId ? [] : [withGame(entry, { ...game, teamAId, teamBId })];
  });

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
];

/** The cut days the sweeps of this pool have read, and the day later games are scored from. */
export const MODEL_CUTS = ["2026-09-01", "2026-09-08", "2026-09-15"];
export const MODEL_SCORE_FROM = "2026-09-23";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * The first club's chance against the second, as `predictMatchup` reads it, held to `floor` either
 * way rather than `MATCHUP_PROBABILITY_FLOOR`, on a curve `spread` times as wide: the same at the
 * shipped floor and a spread of one, to the digit.
 */
export const chanceAt = (
  ratingA: number,
  ratingB: number,
  ageLevel: number | undefined,
  floor = MATCHUP_PROBABILITY_FLOOR,
  spread = 1
): number => {
  const margin = clamp(ratingA - ratingB, -MATCHUP_MARGIN_CAP, MATCHUP_MARGIN_CAP);
  const width = matchupOddsSpread(ageLevel) * spread;
  return clamp(1 / (1 + Math.exp(-margin / width)), floor, 1 - floor);
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
const predicted = (fit: ScoutYearFit, game: ScoutGame, floor?: number, spread?: number) => {
  const shown = (id: string) =>
    fit.confident(fit.adjusted.ratings.get(id) ?? 0, fit.effective.get(id) ?? 0);
  const a = shown(game.teamAId);
  const b = shown(game.teamBId);
  const level = fit.homeLevels.get(game.teamAId) ?? fit.homeLevels.get(game.teamBId);
  return {
    margin: clamp(a - b, -MATCHUP_MARGIN_CAP, MATCHUP_MARGIN_CAP),
    win: chanceAt(a, b, level, floor, spread),
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
  const sides: number[] = [];
  const decidedSides: number[] = [];
  const shippedChances: Array<{ win: number; won: boolean }> = [];
  const cutReadings: ModelSweep["cuts"] = [];
  // Each distinct fit once a cut: the floors share the shipped fit.
  const tuningKey = (variant: ModelVariant) =>
    `${variant.tuning?.cap ?? ""}|${variant.tuning?.shrinkage ?? ""}|${variant.leaveOut || variant.refile ? variant.key : ""}`;

  for (const cut of cuts) {
    const trained = scoutRatingGames(page.id, teams, games, ageGroups, undefined, cut);
    const fits = new Map<string, ScoutYearFit>();
    const fitOf = (variant: ModelVariant, at: number) => {
      const key = tuningKey(variant);
      const known = fits.get(key);
      if (known) return known;
      const started = now();
      const drop = variant.leaveOut?.(teams, trained);
      const kept = drop ? trained.filter(({ game }) => !drop.has(game.id)) : trained;
      const onto = variant.refile;
      const fit = fitScoutYear(
        year,
        teams,
        onto
          ? refiledGames(
              games,
              (game) => game,
              (_, game) => game,
              onto
            )
          : games,
        onto
          ? refiledGames(
              kept,
              (entry) => entry.game,
              (entry, game) => ({ ...entry, game }),
              onto
            )
          : kept,
        ageGroups,
        variant.tuning ?? {}
      );
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
    variants.forEach((variant, at) => {
      const fit = fitOf(variant, at);
      const pile = piles[at]!;
      for (const { game } of scored) {
        const margin = clamp(ratedMargin(game) ?? 0, -RATING_CAP, RATING_CAP);
        const guess = predicted(fit, game, variant.floor, variant.spread);
        pile.squared.push((guess.margin - margin) ** 2);
        if (margin === 0) continue;
        const won = margin > 0;
        const chance = clamp(won ? guess.win : 1 - guess.win, 1e-9, 1);
        pile.logLoss.push(-Math.log(chance));
        pile.brier.push((guess.win - (won ? 1 : 0)) ** 2);
        if (at === 0) shippedChances.push({ win: guess.win, won });
      }
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

  return {
    year,
    cuts: cutReadings,
    games: shippedPile.squared.length,
    crossAge: cutReadings.reduce((sum, cut) => sum + cut.crossAge, 0),
    standIns: cutReadings.reduce((sum, cut) => sum + cut.standIns, 0),
    decided: shippedPile.logLoss.length,
    variants: readings,
    calibration,
  };
};
