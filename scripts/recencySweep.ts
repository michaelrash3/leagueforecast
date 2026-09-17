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
import { parseTeamRankingsJson, type TeamRankingsBackup } from "../src/lib/teamRankingsBackup.ts";
import {
  compareRecencySchemes,
  type ScoutBacktestResult,
  type ScoutResidual,
} from "../src/lib/scoutBacktest.ts";
import { RECENCY_SCHEMES } from "../src/lib/ratingRecency.ts";
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
  const pool = parseTeamRankingsJson(readFileSync(path, "utf8"));
  if (!pool) {
    throw new Error(
      `${path} is not a Team Rankings backup. Export one from Setup — the button writes the JSON this reads.`
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
const cutsFor = (composition: Composition): number[] => {
  const { days, breaks } = composition;
  if (days.length < 4) return [];
  const candidates = [
    ...breaks.map((entry) => entry.after),
    ...[0.5, 0.6, 0.7, 0.8].map((share) => days[Math.floor(days.length * share) - 1]!),
  ];
  // Never a cut with nothing after it, and never the same day twice.
  const last = days[days.length - 1]!;
  return [...new Set(candidates.filter((at) => at < last))].sort((a, b) => a - b);
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

/** Only the games the model was in a position to predict at all. */
const connectedOnly = (result: ScoutBacktestResult): ScoutResidual[] =>
  result.residuals.filter((row) => row.connected);

const judge = (results: ScoutBacktestResult[], random: () => number): Verdict[] => {
  const control = results.find((result) => result.recencyKey === "none");
  const controlRows = control ? connectedOnly(control) : [];
  const controlPrint = control ? weightPrint(control) : "";
  return results.map((result) => {
    const rows = connectedOnly(result);
    const paired =
      result.recencyKey === "none" || rows.length === 0
        ? { paired: 0, low: 0, high: 0, wins: 0, ties: rows.length }
        : pairedAgainst(rows, controlRows, random);
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
    };
  });
};

/* -------------------------------------------------------------------------------- the report */

const reportCut = (
  backup: TeamRankingsBackup,
  group: AgeGroup,
  cutOn: number,
  random: () => number
): Verdict[] => {
  const options = { cutOn: asDay(cutOn), keepResiduals: true, ageGapPrior: 2 };
  const results = compareRecencySchemes(
    group.id,
    backup.teams,
    backup.games,
    backup.ageGroups,
    RECENCY_SCHEMES,
    options
  );
  const control = results.find((result) => result.recencyKey === "none")!;

  console.log(`\n  ── cut on ${asDay(cutOn)} ${"─".repeat(46)}`);
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

  const verdicts = judge(results, random);
  const usable = verdicts[0]?.sample ?? 0;
  const dropped = control.sampleSize - usable;
  if (dropped > 0) {
    console.log(
      `     ${dropped} held-out game(s) set aside: ${control.unratedSides} with a team the fit never` +
        ` saw, ${control.splitSamples} between teams it never joined up`
    );
  }
  if (usable < MIN_USABLE_SAMPLE) {
    console.log(
      `     Only ${usable} game(s) the model could actually predict. Too few to rank anything.`
    );
    return [];
  }

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
      `\n     runs closer than the control on the same games, resampled by day.`
  );
  console.log(
    `\n     ${"scheme".padEnd(12)}${"called".padStart(8)}${"runs off".padStart(10)}` +
      `${"|pred|".padStart(8)}${"vs none".padStart(9)}${"95% band".padStart(18)}${"closer on".padStart(11)}`
  );
  ranked.forEach((verdict) => {
    /*
     * A scheme that did nothing has nothing to report against the control. Printing "+0.000" and a
     * band of zero width three times over reads like three measurements rather than one tie shown
     * repeatedly.
     */
    const silent = verdict.key === "none" || verdict.degenerate;
    const band = silent ? "—" : `${signed(verdict.low)} … ${signed(verdict.high)}`;
    const closer = silent ? "—" : `${verdict.wins}/${verdict.sample - verdict.ties}`;
    const flag = verdict.degenerate ? "  (same weights as none)" : "";
    console.log(
      `     ${verdict.key.padEnd(12)}${pct(verdict.accuracy).padStart(8)}${runs(verdict.error).padStart(10)}` +
        `${runs(verdict.prediction).padStart(8)}` +
        `${(silent ? "—" : signed(verdict.paired)).padStart(9)}` +
        `${band.padStart(18)}${closer.padStart(11)}${flag}`
    );
  });

  const degenerate = verdicts.filter((verdict) => verdict.degenerate).map((verdict) => verdict.key);
  if (degenerate.length > 0) {
    console.log(
      `     ${degenerate.length} scheme(s) weighted this training set exactly as the control did` +
        ` — they are not candidates here, they are the control under another name.`
    );
  }

  /*
   * A scheme has beaten the control when its whole interval sits below zero. Anything else is a
   * point estimate with a sign, and on twenty-five games a sign is cheap.
   */
  const beat = verdicts.filter((verdict) => verdict.key !== "none" && verdict.high < 0);
  console.log(
    beat.length === 0
      ? "     Nothing separates from counting every game the same."
      : `     Beats the control outright: ${beat.map((verdict) => verdict.key).join(", ")}`
  );
  return verdicts;
};

const sweepPage = (backup: TeamRankingsBackup, group: AgeGroup): void => {
  console.log(`\n${"=".repeat(78)}\n${pageName(group)}\n${"=".repeat(78)}`);
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

  const cuts = cutsFor(composition);
  if (cuts.length === 0) {
    console.log("\n  Too few days of play to cut. This page cannot answer the question.");
    return;
  }

  // Seeded off the page so a rerun reproduces, and so two pages do not share a resampling.
  const random = makeRandom(composition.played * 7919 + composition.teams);
  const perCut = cuts.map((cutOn) => reportCut(backup, group, cutOn, random));

  /*
   * The only claim worth making from one page: a scheme that beat the control at every cut where
   * the question could be asked. One cut's winner is where the cut fell.
   */
  const asked = perCut.filter((verdicts) => verdicts.length > 0);
  if (asked.length === 0) {
    console.log("\n  No cut on this page held out enough to rank anything.");
    return;
  }
  const always = RECENCY_SCHEMES.map((scheme) => scheme.key)
    .filter((key) => key !== "none")
    .filter((key) =>
      asked.every((verdicts) => {
        const found = verdicts.find((verdict) => verdict.key === key);
        return found !== undefined && !found.degenerate && found.high < 0;
      })
    );
  console.log(
    `\n  Across ${asked.length} cut(s): ` +
      (always.length === 0
        ? "no scheme beat counting every game the same at every cut."
        : `${always.join(", ")} beat the control at every cut.`)
  );
};

const main = (): void => {
  const [path] = process.argv.slice(2);
  if (!path) {
    console.error("usage: npm run recency:sweep -- <backup.json>");
    process.exitCode = 1;
    return;
  }
  const backup = read(path);

  console.log(
    "A weight is a count, and every scheme averages one, so what separates them is only which\n" +
      "games count more than others — never how much evidence the fit is handed in total."
  );

  // Biggest first: the page most likely to be able to answer anything leads the report.
  const count = (group: AgeGroup) =>
    backup.games.filter((game: ScoutGame) => game.ageGroupId === group.id).length;
  const pages = [...backup.ageGroups].sort((a, b) => count(b) - count(a));
  pages.forEach((group) => sweepPage(backup, group));

  console.log(
    `\n${"=".repeat(78)}\nA scheme is worth believing when it beats the control at more than one cut,` +
      "\non more than one page, and by a margin whose whole interval clears zero. Anything\n" +
      "less is where the cut happened to fall."
  );
};

main();
