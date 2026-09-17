/**
 * Runs the recency sweep over a pool exported from the app, and prints what it found.
 *
 * A research tool rather than a feature: the question it answers — how fast does a rating go off,
 * and does weighting old games down predict better — is asked once, against seasons that have
 * already happened, and the answer becomes a constant in the app. It lives in `scripts/` for that
 * reason, and it reads the same JSON backup the Setup page writes so there is no second export
 * format to keep true.
 *
 *   npm run recency:sweep -- <backup.json>
 *
 * Most of what follows is not the comparison. It is the checks that decide whether the comparison
 * is entitled to mean anything, because a sweep of this shape has an unusual number of ways to
 * produce a confident, tidy, entirely empty answer:
 *
 *   - a hold-out of twenty-five games, where every scheme lands within a rounding error of every
 *     other and a bare ranking hides it;
 *   - schemes that are not candidates at all, because on this pool their weights come out
 *     bit-identical to the control's, and a stable sort dresses the tie up as a win;
 *   - a winner that won by shrinking its own predictions toward zero, which is the baseline's
 *     answer, rather than by knowing anything;
 *   - held-out games between teams the fit never joined up, where the printed margin is an
 *     artefact of the arithmetic rather than an estimate;
 *   - a cut that lands in mid-spring, so the question the whole exercise exists to ask — what is
 *     a fall season worth in March — is never put.
 *
 * So: every page is swept at several cuts, every number is restricted to games the model was in a
 * position to predict, every scheme is compared against the control game by game rather than mean
 * against mean, and anything that cannot be measured says so instead of being ranked.
 */
import { readFileSync } from "node:fs";
import {
  looksLikeJsonBackup,
  parseTeamRankingsCsv,
  parseTeamRankingsJson,
  type TeamRankingsBackup,
} from "../src/lib/teamRankingsBackup.ts";
import {
  compareRecencySchemes,
  type ScoutBacktestResult,
  type ScoutResidual,
} from "../src/lib/scoutBacktest.ts";
import { RECENCY_SCHEMES, type RecencyScheme } from "../src/lib/ratingRecency.ts";
import {
  describeTidy,
  proposeSeasonPairings,
  tidyPool,
  type GcImportState,
} from "../src/lib/gameChangerImport.ts";
import { poolHealth, settleableNow } from "../src/lib/poolHealth.ts";
import {
  ageGroupLevel,
  ageGroupYear,
  countsTowardRating,
  dedupeLeagueFixtures,
  rankingPoolGroupIds,
  scoutRatingGames,
  type AgeGroup,
  type ScoutGame,
} from "../src/lib/teamRankings.ts";

/**
 * The Node globals this script needs. Declared here rather than via `@types/node`, for the same
 * reason `api/gc-team.ts` and `scripts/verify-gc-pull.ts` do it: installing that package changes
 * global timer typings for the browser project too.
 */
declare const process: { argv: string[]; exitCode?: number };
declare const console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

const DAY_MS = 24 * 60 * 60 * 1000;
/** A break this long is a season boundary rather than a quiet fortnight. */
const BREAK_DAYS = 30;
/** Resamples for the interval. Enough that the third decimal stops moving. */
const BOOTSTRAP = 2000;
/** Below this there is no point printing a ranking; say the page cannot answer instead. */
const MIN_USABLE_SAMPLE = 12;
/**
 * And below this many distinct playing days, whatever the game count.
 *
 * The interval is resampled by day, because a Saturday's eight games share a field, a weather and a
 * small set of teams. Six clusters do not give a bootstrap anything to calibrate on, so a band
 * computed from them is a decoration.
 */
const MIN_USABLE_DAYS = 8;
/**
 * Shuffles of the training calendar used to find out what this procedure does when there is
 * nothing to find. See `permutedNull`.
 */
const DEFAULT_PERMUTATIONS = 200;
/**
 * The pre-registered candidates, and the reason there are five rather than thirteen.
 *
 * Thirteen simultaneous intervals against zero is thirteen chances to be unlucky, and most of the
 * thirteen are not distinct questions anyway — days-90 and days-120 differ by a hair over a
 * fourteen-week training window. Five spread across the three families, named before looking at
 * anything, is a fair test. `--all` puts the rest back for a look around, which is a different
 * activity from deciding.
 */
const CANDIDATE_KEYS = ["none", "days-60", "days-120", "games-10", "block-0.35"];
/**
 * A scheme whose heaviest training weight is less than this times its lightest is not weighting.
 *
 * Bit-identical weights are caught by the fingerprint, but a scheme can be all but identical
 * without being exactly identical — games-40 over one season spans a ratio of about 1.2, moves
 * fall's share of the training weight by a single percentage point, and is then ranked as though
 * it had an opinion.
 */
const MIN_WEIGHT_SPREAD = 1.25;
/** Runs. Below this a margin is not worth freezing into the app, whatever its interval says. */
const WORTH_SHIPPING = 0.05;
/**
 * Days left empty between the last game fitted on and the first one scored, at an in-season cut.
 *
 * A chronological hold-out flatters recency for free: the games being predicted are the newest in
 * the pool, so leaning on recent games moves the fit toward the target by construction. At a break
 * cut the winter is its own embargo and this is left at zero; the alternative is an embargo on top
 * of a five-month gap, which empties the hold-out.
 */
const IN_SEASON_EMBARGO_DAYS = 14;

/**
 * Reads the backup, and then puts it through the same tidy the app does before it ranks anything.
 *
 * A backup is a decode, not a state: it is whatever the browser happened to have when the button
 * was pressed. The rankings are never computed on that. They are computed after bracket slots have
 * been settled from the other team's schedule, after a club's second GameChanger id has been folded
 * into its first, after the same game written twice has been collapsed to once, and after the
 * wiffle-ball teams have gone. Fitting the raw file instead means fitting a pool nobody ranks, and
 * every one of those passes moves games across the timeline or changes who a team is — which is
 * exactly what this sweep is trying to measure.
 *
 * The tidy is the app's own, not a second copy of its rules, so the two cannot drift apart.
 */
const read = (path: string): TeamRankingsBackup => {
  // Either backup the app has ever written. The older CSV is read the same way the app reads it,
  // so a file kept from before the JSON export existed is still a pool this can sweep.
  const raw = readFileSync(path, "utf8");
  const pool = looksLikeJsonBackup(raw) ? parseTeamRankingsJson(raw) : parseTeamRankingsCsv(raw);
  if (!pool) {
    throw new Error(
      `${path} is not a Team Rankings backup. Export one from Setup — either the JSON or the older CSV.`
    );
  }
  const before: GcImportState = {
    ageGroups: pool.ageGroups,
    teams: pool.teams,
    games: pool.games,
  };
  const health = poolHealth(before, "");
  const { state, ...counts } = tidyPool(before);
  const notes = describeTidy({ state, ...counts });

  console.log(
    `Read ${pool.ageGroups.length} pages, ${pool.teams.length} teams, ${pool.games.length} games` +
      ` (${health.played} played).`
  );
  console.log(
    `  stand-ins: ${health.placeholders} bracket slot(s), ${health.nameOnly} known only by name,` +
      ` in ${health.standInGames} game(s) of which ${health.standInPlayed} have a result.`
  );
  if (notes.length === 0) {
    console.log("  Tidy: nothing to do — the file was exported in the state the app ranks.");
  } else {
    console.log("  Tidy changed the pool before any of this was fitted:");
    notes.forEach((note) => console.log(`    ${note}`));
  }
  const pairings = proposeSeasonPairings(state.teams, state.games);
  if (pairings.length > 0) {
    console.log(
      `  ! ${pairings.length} squad(s) the app would pair on into their next season, still unpaired.` +
        ` Each one is a club the fit sees as two teams with no game between them.`
    );
  }
  const left = settleableNow(state);
  if (left > 0) {
    console.log(
      `  ! ${left} stand-in game(s) the app could still settle. Settle them and re-export: until` +
        ` then some of these teams are two teams, and a rating cannot join what it cannot see.`
    );
  }
  return { ...pool, teams: state.teams, games: state.games, ageGroups: state.ageGroups };
};

const pageName = (group: AgeGroup): string => {
  const level = ageGroupLevel(group);
  const year = ageGroupYear(group);
  return level === undefined || year === undefined ? group.name : `${level}U ${year}`;
};

const pct = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const runs = (value: number | null): string => (value === null ? "—" : value.toFixed(3));
const signed = (value: number): string => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(3)}`;
const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/** Seeded, so two runs over the same file print the same intervals. */
const makeRandom = (seed: number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
};

/* ------------------------------------------------------------------ what the page is made of */

type Composition = {
  played: number;
  teams: number;
  days: number[];
  breaks: Array<{ after: number; gap: number }>;
};

const compositionOf = (backup: TeamRankingsBackup, group: AgeGroup): Composition => {
  const rated = scoutRatingGames(group.id, backup.teams, backup.games, backup.ageGroups);
  const played = rated.filter((entry) => countsTowardRating(entry.game));
  const days = played
    .map((entry) => (entry.game.date ? Date.parse(`${entry.game.date}T12:00:00Z`) : Number.NaN))
    .filter((at) => Number.isFinite(at))
    .sort((a, b) => a - b);
  const breaks: Array<{ after: number; gap: number }> = [];
  for (let at = 1; at < days.length; at += 1) {
    const gap = Math.round((days[at]! - days[at - 1]!) / DAY_MS);
    if (gap >= BREAK_DAYS) breaks.push({ after: days[at - 1]!, gap });
  }
  return {
    played: played.length,
    teams: new Set(played.flatMap(({ game }) => [game.teamAId, game.teamBId])).size,
    days,
    breaks,
  };
};

const asDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

/**
 * Where to cut, as calendar days.
 *
 * The day before each long break first, because that is the only cut that puts the question this
 * exercise exists to ask — what is a fall season worth once spring starts — and a cut chosen by
 * row quantile will land there only by accident. Then a spread of quantile cuts, so a scheme that
 * only wins at the one flattering place to stand is visibly only winning there.
 */
const cutsFor = (composition: Composition, squadYear: number | undefined): Cut[] => {
  const { days, breaks } = composition;
  if (days.length < 4) return [];
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const seen = new Set<number>();
  const cuts: Cut[] = [];
  const add = (at: number, kind: Cut["kind"], gap: number) => {
    if (at <= first || at >= last || seen.has(at)) return;
    seen.add(at);
    cuts.push({ at, kind, gap });
  };
  breaks.forEach((entry) => add(entry.after, "pre-break", entry.gap));

  /*
   * A nationwide pool has no break in it, and that is not because there is no winter.
   * It is because the winter is regional: a club in Kentucky stops in October and starts again in
   * March, a club in Florida and Arizona plays straight through, and pooled together somebody is
   * always playing. Looking for a month of silence in the pool finds nothing, and the one question
   * this exercise exists to ask goes unasked on exactly the pool big enough to answer it.
   *
   * So when no gap turns up, the turn of the calendar year stands in for it. A squad year runs
   * August to July, so 31 December splits its autumn from its spring — which is what "what is a
   * fall season worth in the spring" means, whatever the weather was where each game was played.
   */
  if (breaks.length === 0 && squadYear !== undefined) {
    add(Date.parse(`${squadYear - 1}-12-31T12:00:00Z`), "turn-of-year", 0);
  }

  [0.5, 0.6, 0.7, 0.8].forEach((share) =>
    add(days[Math.floor(days.length * share) - 1]!, "in-season", 0)
  );
  return cuts.sort((a, b) => a.at - b.at);
};

/* --------------------------------------------------------------- is this pool what it claims */

/**
 * The checks that come before any comparison, each one a way the file can fail to be the pool the
 * app actually ranks.
 */
const preflight = (
  backup: TeamRankingsBackup,
  group: AgeGroup,
  composition: Composition
): string[] => {
  const notes: string[] = [];
  const rated = scoutRatingGames(group.id, backup.teams, backup.games, backup.ageGroups);
  const played = rated.filter((entry) => countsTowardRating(entry.game)).map(({ game }) => game);

  /*
   * The question this page exists to answer is what a fall season is worth in the spring, and a
   * rating can only carry anything across the winter through a team that played on both sides of
   * it. GameChanger mints a club a fresh team id every season, so unless those two ids have been
   * folded together the fall squads and the spring squads are disjoint sets of teams with no game
   * between them — two seasons sitting in one page, touching nowhere.
   *
   * That does not merely wash the answer out. It manufactures one: with the blocks unjoined, the
   * spring teams each carry a handful of games against a ridge built for more, so the control's
   * ratings are the ones dragged toward zero while a scheme that forgets the fall concentrates its
   * whole weight budget on the spring and keeps its own. Decay then "wins" by a wide margin, on a
   * page where no weighting could have moved a single piece of evidence across the break. Note it
   * defeats the shrinkage column too, and backwards: here it is the *control* whose predictions
   * shrink, not the winner's.
   */
  const firstBreak = composition.breaks[0];
  if (firstBreak !== undefined) {
    const side = new Map<string, Set<string>>();
    played.forEach((game) => {
      if (!game.date) return;
      const at = Date.parse(`${game.date}T12:00:00Z`);
      const half = at <= firstBreak.after ? "before" : "after";
      [game.teamAId, game.teamBId].forEach((id) => {
        const seen = side.get(id) ?? new Set<string>();
        seen.add(half);
        side.set(id, seen);
      });
    });
    const spanning = [...side.values()].filter((halves) => halves.size === 2).length;
    notes.push(
      spanning === 0
        ? `not one team played on both sides of the ${firstBreak.gap}-day break — the two halves of` +
            ` this page share no team, so nothing could carry across it whatever the weights, and any` +
            ` result below about the winter is an artefact`
        : `${spanning} of ${side.size} teams played on both sides of the ${firstBreak.gap}-day break` +
            ` — only those can carry a rating across it`
    );
  }

  /*
   * A page carrying a League Standings season is ranked on its own games *plus* the ones derived
   * from that season, and a backup holds no seasons — so the sweep would be fitting a strict
   * subset of the real pool and validating a model nobody ships.
   */
  if (group.seasonIds.length > 0) {
    notes.push(
      `carries ${group.seasonIds.length} League Standings season(s), which a backup does not hold —` +
        ` this page's real pool is bigger than what is swept here`
    );
  }

  // The app dedupes league fixtures before rating. A duplicate that straddles a cut is the fit
  // being handed the exact result it is then scored on.
  const deduped = dedupeLeagueFixtures(played);
  if (deduped.length !== played.length) {
    notes.push(`${played.length - deduped.length} duplicate fixture(s) the app would have merged`);
  }

  /*
   * A near-duplicate the day-exact dedupe cannot see: the same pair, the same score, a day or two
   * apart because two schedules disagreed about the date. Straddling a cut, each one is leakage.
   */
  const seen = new Map<string, number[]>();
  played.forEach((game) => {
    if (!game.date) return;
    const pair = [game.teamAId, game.teamBId].sort().join("|");
    const score = [game.teamAScore, game.teamBScore].sort().join("-");
    const key = `${pair}#${score}`;
    const at = Date.parse(`${game.date}T12:00:00Z`);
    seen.set(key, [...(seen.get(key) ?? []), at]);
  });
  let nearDuplicates = 0;
  seen.forEach((times) => {
    const sorted = [...times].sort((a, b) => a - b);
    for (let at = 1; at < sorted.length; at += 1) {
      if (sorted[at]! - sorted[at - 1]! <= 2 * DAY_MS) nearDuplicates += 1;
    }
  });
  if (nearDuplicates > 0) {
    notes.push(
      `${nearDuplicates} same-pair same-score result(s) within two days of each other — likely one` +
        ` game written twice, and leakage if a cut falls between the copies`
    );
  }

  /*
   * "Predict nothing" is only the right control if team A is not systematically the stronger side.
   * On a GameChanger row team A is whichever schedule was read, which is not a coin flip.
   */
  const margins = played
    .filter((game) => game.teamAScore !== undefined && game.teamBScore !== undefined)
    .map((game) => game.teamAScore! - game.teamBScore!);
  const bias = mean(margins);
  if (Math.abs(bias) > 0.2) {
    notes.push(
      `team A outscores team B by ${bias.toFixed(2)} runs on average — "predict an even game" is a` +
        ` worse control than it needs to be, so every lift below is flattered by roughly that much`
    );
  }
  return notes;
};

/* ------------------------------------------------------- comparing schemes against the control */

type Verdict = {
  key: string;
  sample: number;
  error: number | null;
  prediction: number | null;
  accuracy: number | null;
  /** Mean of (this scheme's error − the control's) on the same games. Negative is better. */
  paired: number;
  low: number;
  high: number;
  /** Games this scheme landed closer on than the control did. */
  wins: number;
  ties: number;
  /** Its weights over the training games came out identical to the control's. */
  degenerate: boolean;
  /** Heaviest training weight over lightest. At 1 the scheme is not weighting anything. */
  spread: number;
  /**
   * What this same scheme scored when the training calendar was shuffled — the reference the
   * observed margin has to beat. Null when the null was not run.
   */
  nullMean: number | null;
  /** The family-wise threshold: the best any candidate managed on a shuffled calendar. */
  nullBest: number | null;
};

/**
 * Compares two schemes on the games they both faced, and says how sure it is.
 *
 * Paired, and resampled by *day* rather than by game. Paired because every scheme is scored on an
 * identical hold-out, so the difference per game is the measurement and comparing two means throws
 * away the pairing that makes it precise. By day because youth baseball is played in weekends:
 * eight games on one Saturday share a field, a weather, and a small set of teams, and treating
 * them as eight independent observations claims a precision the pool does not have.
 */
const pairedAgainst = (
  scheme: ScoutResidual[],
  control: ScoutResidual[],
  random: () => number
): { paired: number; low: number; high: number; wins: number; ties: number } => {
  const byGame = new Map(control.map((row) => [row.gameId, row]));
  const pairs = scheme.flatMap((row) => {
    const other = byGame.get(row.gameId);
    return other ? [{ day: Math.round(row.daysAfter), delta: row.error - other.error }] : [];
  });
  if (pairs.length === 0) return { paired: 0, low: 0, high: 0, wins: 0, ties: 0 };

  const days = [...new Set(pairs.map((pair) => pair.day))];
  const byDay = new Map(days.map((day) => [day, pairs.filter((pair) => pair.day === day)]));
  const draws: number[] = [];
  for (let round = 0; round < BOOTSTRAP; round += 1) {
    const sample: number[] = [];
    for (let pick = 0; pick < days.length; pick += 1) {
      const day = days[Math.floor(random() * days.length)]!;
      (byDay.get(day) ?? []).forEach((pair) => sample.push(pair.delta));
    }
    if (sample.length > 0) draws.push(mean(sample));
  }
  draws.sort((a, b) => a - b);
  const at = (share: number) =>
    draws[Math.min(draws.length - 1, Math.floor(draws.length * share))] ?? 0;
  return {
    paired: mean(pairs.map((pair) => pair.delta)),
    low: at(0.025),
    high: at(0.975),
    wins: pairs.filter((pair) => pair.delta < 0).length,
    ties: pairs.filter((pair) => pair.delta === 0).length,
  };
};

/**
 * A fingerprint of what a scheme actually did, so two schemes that did the same thing can be seen
 * to have done the same thing.
 *
 * Taken from the predictions rather than the weights, because the predictions are what the weights
 * were for: `byBlock` hands back every weight at 1 whenever the training half holds no long break,
 * which is guaranteed on a three-week page, and three of the four block schemes are then the
 * control with a different name. A stable sort will happily award one of them first place.
 */
const weightPrint = (result: ScoutBacktestResult): string =>
  result.residuals.map((row) => row.predicted.toFixed(9)).join(",");

/**
 * What a scheme's weights actually look like on this training set.
 *
 * Asked of the scheme itself rather than reasoned about, because the answer is not a property of
 * the scheme — it is a property of the scheme *and this calendar*. `byBlock` weights nothing when
 * the training half holds no long break; a long half-life weights almost nothing over a short
 * window. Either way the scheme is in the table claiming to be a candidate.
 */
const weightSpread = (
  backup: TeamRankingsBackup,
  group: AgeGroup,
  scheme: RecencyScheme,
  cutAt: number
): number => {
  const train = scoutRatingGames(group.id, backup.teams, backup.games, backup.ageGroups)
    .filter(({ game }) => countsTowardRating(game) && game.date)
    .map(({ game }) => ({
      at: Date.parse(`${game.date}T12:00:00Z`),
      home: game.teamAId,
      away: game.teamBId,
    }))
    .filter((entry) => Number.isFinite(entry.at) && entry.at <= cutAt)
    .sort((a, b) => a.at - b.at);
  if (train.length === 0) return 1;
  const weights = scheme.weigh(train, cutAt);
  const low = Math.min(...weights);
  const high = Math.max(...weights);
  return low <= 0 ? Infinity : high / low;
};

/**
 * The same sweep, on a calendar that has been shuffled.
 *
 * This is the step without which none of the rest counts. A chronological hold-out is not a neutral
 * test bench: the games being scored are always the newest in the pool, so a scheme that leans on
 * recent games moves the fit toward its target by construction, and it does that whether or not
 * there is any real drift to catch. Measured on a pool built with *zero* fall-to-spring drift —
 * team strengths literally unchanged across the winter, nothing whatever for recency to learn —
 * every decayed scheme still came in ahead of the control, monotonically in how aggressive it was.
 * Testing "is the margin below zero" against that background asks the wrong question, and it
 * answers yes.
 *
 * So the dates of the training games are shuffled among themselves. Every game keeps its teams and
 * its result, every day keeps its number of games, every team keeps its game count, and the cut
 * falls in exactly the same place — the only thing destroyed is *which* games were recent. Whatever
 * margin a scheme still earns on that is the margin the procedure hands out for free, and the real
 * one has to beat it.
 */
const permuteTrainDates = (
  games: readonly ScoutGame[],
  cutAt: number,
  random: () => number
): ScoutGame[] => {
  const inTrain = (game: ScoutGame): boolean => {
    if (!game.date) return false;
    const at = Date.parse(`${game.date}T12:00:00Z`);
    return Number.isFinite(at) && at <= cutAt;
  };
  const dates = games.filter(inTrain).map((game) => game.date!);
  for (let at = dates.length - 1; at > 0; at -= 1) {
    const pick = Math.floor(random() * (at + 1));
    const held = dates[at]!;
    dates[at] = dates[pick]!;
    dates[pick] = held;
  }
  let next = 0;
  return games.map((game) => (inTrain(game) ? { ...game, date: dates[next++]! } : game));
};

/** Only the games the model was in a position to predict at all. */
const connectedOnly = (result: ScoutBacktestResult): ScoutResidual[] =>
  result.residuals.filter((row) => row.connected);

/** The mean paired difference against the control, per scheme. The one number a run turns on. */
const marginsOf = (results: ScoutBacktestResult[]): Map<string, number> => {
  const control = results.find((result) => result.recencyKey === "none");
  const controlRows = control ? connectedOnly(control) : [];
  const byGame = new Map(controlRows.map((row) => [row.gameId, row]));
  const margins = new Map<string, number>();
  results.forEach((result) => {
    const deltas = connectedOnly(result).flatMap((row) => {
      const other = byGame.get(row.gameId);
      return other ? [row.error - other.error] : [];
    });
    margins.set(result.recencyKey, deltas.length === 0 ? 0 : mean(deltas));
  });
  return margins;
};

const judge = (
  results: ScoutBacktestResult[],
  schemes: RecencyScheme[],
  spreads: Map<string, number>,
  nulls: Map<string, number[]>,
  random: () => number
): Verdict[] => {
  const control = results.find((result) => result.recencyKey === "none");
  const controlRows = control ? connectedOnly(control) : [];
  const controlPrint = control ? weightPrint(control) : "";
  /*
   * The family-wise threshold: on each shuffled calendar, the best margin *any* candidate managed.
   * Comparing one scheme's real margin against its own shuffled margins would ignore that it was
   * picked out of five; comparing it against the best of five on each shuffle does not.
   */
  const bests: number[] = [];
  const rounds = Math.max(0, ...[...nulls.values()].map((draws) => draws.length));
  for (let round = 0; round < rounds; round += 1) {
    const perScheme = schemes
      .filter((scheme) => scheme.key !== "none")
      .map((scheme) => nulls.get(scheme.key)?.[round])
      .filter((value): value is number => value !== undefined);
    if (perScheme.length > 0) bests.push(Math.min(...perScheme));
  }
  bests.sort((a, b) => a - b);
  // The fifth percentile of the best-of-five under the null: what a real margin has to clear.
  const nullBest = bests.length === 0 ? null : (bests[Math.floor(bests.length * 0.05)] ?? null);

  return results.map((result) => {
    const rows = connectedOnly(result);
    const paired =
      result.recencyKey === "none" || rows.length === 0
        ? { paired: 0, low: 0, high: 0, wins: 0, ties: rows.length }
        : pairedAgainst(rows, controlRows, random);
    const draws = nulls.get(result.recencyKey) ?? [];
    return {
      key: result.recencyKey,
      sample: rows.length,
      error: rows.length === 0 ? null : mean(rows.map((row) => row.error)),
      prediction: rows.length === 0 ? null : mean(rows.map((row) => Math.abs(row.predicted))),
      accuracy: (() => {
        const called = rows.filter((row) => row.actual !== 0 && row.predicted !== 0);
        if (called.length === 0) return null;
        return (
          called.filter((row) => Math.sign(row.predicted) === Math.sign(row.actual)).length /
          called.length
        );
      })(),
      ...paired,
      degenerate: result.recencyKey !== "none" && weightPrint(result) === controlPrint,
      spread: spreads.get(result.recencyKey) ?? 1,
      nullMean: draws.length === 0 ? null : mean(draws),
      nullBest: result.recencyKey === "none" ? null : nullBest,
    };
  });
};

/* -------------------------------------------------------------------------------- the report */

/**
 * Where to cut, and which question that cut puts.
 *
 * `pre-break` and `turn-of-year` are the two ways of asking what a season is worth across a winter
 * — one found in the pool, one imposed on it when the pool is too big to have a quiet month.
 * `in-season` cuts ask a smaller question and are read as one family rather than several answers.
 */
type Cut = { at: number; kind: "pre-break" | "turn-of-year" | "in-season"; gap: number };

const reportCut = (
  backup: TeamRankingsBackup,
  group: AgeGroup,
  cut: Cut,
  schemes: RecencyScheme[],
  permutations: number,
  random: () => number
): Verdict[] => {
  /*
   * The embargo, which only some cuts need. A chronological hold-out scores the very next weekend,
   * and leaning on recent games walks the fit toward that weekend for free; a fortnight of empty
   * calendar makes the held-out games genuinely *later* rather than merely last. At a break cut the
   * five-month gap is already the embargo, and stacking another on top only empties the hold-out.
   */
  const gapDays = cut.kind === "in-season" ? IN_SEASON_EMBARGO_DAYS : 0;
  const options = { cutOn: asDay(cut.at), keepResiduals: true, ageGapPrior: 2, gapDays };
  const results = compareRecencySchemes(
    group.id,
    backup.teams,
    backup.games,
    backup.ageGroups,
    schemes,
    options
  );
  const control = results.find((result) => result.recencyKey === "none")!;

  const asks =
    cut.kind === "pre-break"
      ? `the primary question — what a season is worth across the ${cut.gap}-day break that follows`
      : cut.kind === "turn-of-year"
        ? "the primary question — what the autumn is worth in the spring. This pool never goes quiet" +
          " for a month, so the turn of the year stands in for a break it does not have"
        : "an in-season question, and one of a family whose training sets nest and whose hold-outs overlap";
  console.log(`\n  ── cut on ${asDay(cut.at)} ${"─".repeat(46)}`);
  console.log(`     ${asks}`);
  if (gapDays > 0)
    console.log(`     ${gapDays} days left empty after the cut before scoring starts`);
  if (control.sampleSize === 0) {
    console.log("     Nothing held out at this cut. It asks no question.");
    return [];
  }
  const { trainFrom, trainTo, testFrom, testTo } = control.span!;
  console.log(
    `     fit ${trainFrom}…${trainTo} (${control.trainSize} games)  →  scored ${testFrom}…${testTo}` +
      ` (${control.sampleSize} games)`
  );
  console.log(
    `     training teams in ${control.trainComponents} connected piece(s), biggest ${control.largestComponent}`
  );

  const usableRows = connectedOnly(control);
  const usable = usableRows.length;
  const usableDays = new Set(usableRows.map((row) => Math.round(row.daysAfter))).size;
  const dropped = control.sampleSize - usable;
  if (dropped > 0) {
    console.log(
      `     ${dropped} held-out game(s) set aside: ${control.unratedSides} with a team the fit never` +
        ` saw, ${control.splitSamples} between teams it never joined up`
    );
  }
  if (usable < MIN_USABLE_SAMPLE || usableDays < MIN_USABLE_DAYS) {
    console.log(
      `     ${usable} game(s) on ${usableDays} day(s) the model could actually predict. Too few to` +
        ` rank anything — the band is resampled by day, and ${usableDays} clusters calibrate nothing.`
    );
    return [];
  }

  /*
   * The null. Everything above is descriptive; this is the part that decides whether any of it
   * means something, and it is the expensive part — one full sweep per shuffle.
   */
  const nulls = new Map<string, number[]>(schemes.map((scheme) => [scheme.key, []]));
  if (permutations > 0) {
    /*
     * Said out loud before it starts, because on a nationwide pool this is the difference between
     * a minute and an afternoon. One fit over fifty thousand games is about a second, and the null
     * wants `permutations` sweeps of every scheme — so the honest thing is to print the arithmetic
     * rather than to appear to have hung.
     */
    const fits = permutations * schemes.length;
    console.log(
      `\n     running the null: ${permutations} shuffles × ${schemes.length} schemes = ` +
        `${fits.toLocaleString()} fits over ${control.trainSize.toLocaleString()} training games.` +
        (control.trainSize > 20_000
          ? " On a pool this size that is a long wait — narrow it with --page= if it is not the page you want."
          : "")
    );
  }
  for (let round = 0; round < permutations; round += 1) {
    const shuffled = permuteTrainDates(backup.games, cut.at, random);
    const margins = marginsOf(
      compareRecencySchemes(group.id, backup.teams, shuffled, backup.ageGroups, schemes, options)
    );
    margins.forEach((margin, key) => nulls.get(key)?.push(margin));
  }

  const spreads = new Map(
    schemes.map((scheme) => [scheme.key, weightSpread(backup, group, scheme, cut.at)])
  );
  const verdicts = judge(results, schemes, spreads, nulls, random);

  /*
   * Ordered by how often the favoured side actually won, not by the error. Shrinking every rating
   * toward zero lowers the error without knowing anything, but it barely moves which side is
   * favoured — so accuracy is the column that answers "did recency re-order the teams", and the
   * error is the one to read afterwards, knowing it can be bought.
   */
  const ranked = [...verdicts].sort(
    (a, b) =>
      (b.accuracy ?? -1) - (a.accuracy ?? -1) || (a.error ?? Infinity) - (b.error ?? Infinity)
  );
  /*
   * Two different columns decide two different things, and they are allowed to disagree. The order
   * is by `called`, because that is the one a shrinking scheme cannot buy. The claim underneath is
   * from the band, because that is the one with a width on it.
   */
  console.log(
    `\n     called = share of decisive games the favoured side won · |pred| = mean size of the` +
      `\n     predicted margins, the tell for a scheme that won by predicting less · vs none = mean` +
      `\n     runs closer than the control on the same games · shuffled = what the same scheme` +
      `\n     scored with the training calendar shuffled, which is the number to beat, not zero.`
  );
  console.log(
    `\n     ${"scheme".padEnd(12)}${"called".padStart(8)}${"runs off".padStart(10)}` +
      `${"|pred|".padStart(8)}${"vs none".padStart(9)}${"95% band".padStart(18)}` +
      `${"shuffled".padStart(10)}${"spread".padStart(8)}`
  );
  ranked.forEach((verdict) => {
    /*
     * A scheme that did nothing has nothing to report against the control. Printing "+0.000" and a
     * band of zero width three times over reads like three measurements rather than one tie shown
     * repeatedly.
     */
    // The control weights nothing by definition; that is what makes it the control, not a flaw.
    const idle =
      verdict.key !== "none" && (verdict.degenerate || verdict.spread < MIN_WEIGHT_SPREAD);
    const silent = verdict.key === "none" || idle;
    const band = silent ? "—" : `${signed(verdict.low)} … ${signed(verdict.high)}`;
    const flag = verdict.degenerate
      ? "  (same weights as none)"
      : idle
        ? "  (barely weights anything)"
        : "";
    console.log(
      `     ${verdict.key.padEnd(12)}${pct(verdict.accuracy).padStart(8)}${runs(verdict.error).padStart(10)}` +
        `${runs(verdict.prediction).padStart(8)}` +
        `${(silent ? "—" : signed(verdict.paired)).padStart(9)}` +
        `${band.padStart(18)}` +
        `${(silent || verdict.nullMean === null ? "—" : signed(verdict.nullMean)).padStart(10)}` +
        `${(Number.isFinite(verdict.spread) ? verdict.spread.toFixed(2) : "∞").padStart(8)}${flag}`
    );
  });

  const idle = verdicts.filter(
    (verdict) =>
      verdict.key !== "none" && (verdict.degenerate || verdict.spread < MIN_WEIGHT_SPREAD)
  );
  if (idle.length > 0) {
    console.log(
      `     ${idle.length} scheme(s) barely weighted this training set at all — they are not` +
        ` candidates here, they are the control under another name.`
    );
  }

  /*
   * What it takes to have beaten the control.
   *
   * Not "the interval clears zero". Zero is the wrong reference: a chronological hold-out pays a
   * small dividend to any scheme that leans on recent games, whether or not there is anything to
   * lean on, so a shuffled calendar still hands out negative margins — measured, monotone in how
   * aggressive the scheme is. The reference is the best margin any candidate managed on a shuffled
   * calendar, which also charges the scheme for having been picked out of several. And a margin
   * that clears all that can still be too small to be worth freezing into the app.
   */
  const threshold = verdicts.find((verdict) => verdict.nullBest !== null)?.nullBest ?? null;
  const beat = verdicts.filter(
    (verdict) =>
      verdict.key !== "none" &&
      !verdict.degenerate &&
      verdict.spread >= MIN_WEIGHT_SPREAD &&
      verdict.high < 0 &&
      threshold !== null &&
      verdict.paired < threshold &&
      Math.abs(verdict.paired) >= WORTH_SHIPPING
  );
  if (threshold !== null) {
    console.log(
      `\n     On a shuffled calendar the best of these schemes still managed ${signed(threshold)}` +
        ` runs (${permutations} shuffles). That is the bar, and ${runs(WORTH_SHIPPING)} runs is the` +
        ` least margin worth making permanent.`
    );
  }
  console.log(
    beat.length === 0
      ? "     Nothing beats counting every game the same by more than the shuffle already gives it."
      : `     Beats the control and the shuffle: ${beat.map((verdict) => verdict.key).join(", ")}`
  );
  return verdicts;
};

const sweepPage = (
  backup: TeamRankingsBackup,
  group: AgeGroup,
  schemes: RecencyScheme[],
  permutations: number
): void => {
  const pooled = rankingPoolGroupIds(group.id, backup.ageGroups)
    .flatMap((id) => backup.ageGroups.filter((entry) => entry.id === id))
    .map((entry) => `${ageGroupLevel(entry) ?? "?"}U`);
  const year = ageGroupYear(group);
  const title =
    year === undefined ? group.name : `Squad year ${year} — ${pooled.join(", ")} rated together`;
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
  const composition = compositionOf(backup, group);
  const { days, breaks } = composition;
  console.log(`  ${composition.played} played games, ${composition.teams} teams`);
  if (days.length >= 2) {
    const first = days[0]!;
    const last = days[days.length - 1]!;
    console.log(
      `  ${asDay(first)} to ${asDay(last)} (${Math.round((last - first) / DAY_MS)} days)`
    );
    console.log(
      breaks.length > 0
        ? `  breaks: ${breaks.map((entry) => `${entry.gap}d after ${asDay(entry.after)}`).join("; ")}`
        : "  no break of a month or more — this page is one block, so it cannot say what a season" +
            " boundary costs"
    );
  }
  preflight(backup, group, composition).forEach((note) => console.log(`  ! ${note}`));

  const cuts = cutsFor(composition, ageGroupYear(group));
  if (cuts.length === 0) {
    console.log("\n  Too few days of play to cut. This page cannot answer the question.");
    return;
  }

  // Seeded off the page so a rerun reproduces, and so two pages do not share a resampling.
  const random = makeRandom(composition.played * 7919 + composition.teams);
  const perCut = cuts.map((cut) => ({
    cut,
    verdicts: reportCut(backup, group, cut, schemes, permutations, random),
  }));

  const asked = perCut.filter((entry) => entry.verdicts.length > 0);
  if (asked.length === 0) {
    console.log("\n  No cut on this page held out enough to rank anything.");
    return;
  }
  const cleared = (verdicts: Verdict[], key: string): boolean => {
    const found = verdicts.find((verdict) => verdict.key === key);
    return (
      found !== undefined &&
      !found.degenerate &&
      found.spread >= MIN_WEIGHT_SPREAD &&
      found.high < 0 &&
      found.nullBest !== null &&
      found.paired < found.nullBest &&
      Math.abs(found.paired) >= WORTH_SHIPPING
    );
  };
  const keys = schemes.map((scheme) => scheme.key).filter((key) => key !== "none");
  const always = keys.filter((key) => asked.every((entry) => cleared(entry.verdicts, key)));

  /*
   * The cuts are not four independent confirmations. Their training sets nest — each in-season cut
   * fits on everything the one before it did and more — and their hold-outs overlap heavily, so
   * "wins at every cut" is closer to one and a half findings than four. The break cut is the only
   * near-independent one, because its training block and its hold-out share no games and no
   * weekend, and it is the only one that asks what a season is worth across a winter.
   */
  const breakCut = asked.find((entry) => entry.cut.kind !== "in-season");
  console.log(
    `\n  Across ${asked.length} cut(s), of which ${asked.filter((entry) => entry.cut.kind === "in-season").length}` +
      " nest inside one another: " +
      (always.length === 0
        ? "no scheme cleared the shuffled calendar everywhere."
        : `${always.join(", ")} cleared it everywhere.`)
  );
  console.log(
    breakCut === undefined
      ? "  No cut across a winter on this page, so it cannot say what a season is worth across one."
      : `  At the ${breakCut.cut.kind === "pre-break" ? "break" : "turn-of-year"} cut, the one that asks it: ` +
          (() => {
            const won = keys.filter((key) => cleared(breakCut.verdicts, key));
            return won.length === 0 ? "nothing cleared it." : `${won.join(", ")}.`;
          })()
  );
};

const main = (): void => {
  const args = process.argv.slice(2);
  const path = args.find((arg) => !arg.startsWith("--"));
  if (!path) {
    console.error(
      "usage: npm run recency:sweep -- <backup.json|backup.csv> [--page=NAME] [--all] [--permutations=N]\n" +
        '  --page           only pages whose name contains this, as in --page="9U 2026"\n' +
        "  --all            look at all thirteen schemes rather than the five pre-registered ones\n" +
        "  --permutations   shuffles of the training calendar per cut (default " +
        `${DEFAULT_PERMUTATIONS}; 0 skips the null and decides nothing)`
    );
    process.exitCode = 1;
    return;
  }
  const all = args.includes("--all");
  /*
   * Which pages to sweep. A nationwide backup holds every age at every squad year, and a page is
   * rated against every other page of its own season year — so one page is one big fit, and
   * eleven of them is eleven. Naming the one being asked about is the difference between a run
   * that finishes and a run that is still going tomorrow.
   */
  const only = args.find((arg) => arg.startsWith("--page="))?.slice("--page=".length);
  const asked = args.find((arg) => arg.startsWith("--permutations="));
  const permutations = asked === undefined ? DEFAULT_PERMUTATIONS : Number(asked.split("=")[1]);
  const schemes = all
    ? RECENCY_SCHEMES
    : CANDIDATE_KEYS.flatMap((key) => RECENCY_SCHEMES.filter((scheme) => scheme.key === key));

  const backup = read(path);

  console.log(
    "A weight is a count, and every scheme averages one, so what separates them is only which\n" +
      "games count more than others — never how much evidence the fit is handed in total."
  );
  console.log(
    all
      ? `Looking at all ${schemes.length} schemes. Thirteen intervals is thirteen chances to be` +
          " unlucky, so read this as a look around rather than a decision."
      : `Five pre-registered candidates: ${schemes.map((scheme) => scheme.key).join(", ")}.`
  );
  console.log(
    permutations > 0
      ? `${permutations} shuffles of the training calendar per cut, to find out what this procedure` +
          " hands out when there is nothing to find."
      : "No shuffles asked for, so nothing below is a decision — only a description."
  );

  const count = (group: AgeGroup) =>
    backup.games.filter((game: ScoutGame) => game.ageGroupId === group.id).length;
  const wanted = backup.ageGroups.filter(
    (group) => only === undefined || pageName(group).toLowerCase().includes(only.toLowerCase())
  );
  /*
   * One sweep per rating pool, not one per page.
   *
   * A page is rated against every other page of its own season year — a 9U that enters a 10U
   * bracket produces a result about both squads, so the year's groups are fitted together. Sweeping
   * "9U 2027" and then "10U 2027" therefore fits the identical pool twice and prints the identical
   * answer under two headings, which on a nationwide backup was eleven runs of the same three
   * experiments, reading like eleven confirmations. One per pool, named for what it is.
   */
  const pools = new Map<string, AgeGroup>();
  wanted.forEach((group) => {
    const key = rankingPoolGroupIds(group.id, backup.ageGroups).slice().sort().join(",");
    const held = pools.get(key);
    if (held === undefined || count(group) > count(held)) pools.set(key, group);
  });
  // Biggest first: the pool most likely to be able to answer anything leads the report.
  const pages = [...pools.values()].sort((a, b) => count(b) - count(a));
  if (pages.length === 0) {
    console.error(
      `No page matches ${only}. This backup holds: ` +
        backup.ageGroups.map((group) => pageName(group)).join(", ")
    );
    process.exitCode = 1;
    return;
  }
  if (only !== undefined) {
    console.log(`Sweeping ${pages.length} page(s) matching "${only}".`);
  }
  pages.forEach((group) => sweepPage(backup, group, schemes, permutations));

  console.log(
    `\n${"=".repeat(78)}\nA scheme is worth shipping when it clears the shuffled calendar at the break` +
      "\ncut, on more than one page, by at least " +
      `${runs(WORTH_SHIPPING)} runs. Short of that the answer is` +
      "\n`none`: it is the incumbent, and a margin this procedure hands out for free is not\n" +
      "a reason to freeze a half-life into the app."
  );
};

main();
