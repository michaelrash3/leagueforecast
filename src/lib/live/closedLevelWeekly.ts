import { failureWords } from "../cloud/firestoreRest";
import { closedLevelJudged } from "../closedLevelWords";
import { dayInstant } from "../ratingRecency";
import { CLOSED_LEVEL_WEEKS, compareClosedLevels, type ClosedLevelCheck } from "../scoutBacktest";
import { ageGroupYear, rankingPoolGroupIds, scoutFitRanks } from "../teamRankings";
import { deriveAllKnown, gamesOnPages } from "./allKnown";
import { CLOSED_LEVEL_FORMAT, type ClosedLevelRecord } from "./closedLevelRecord";
import type { CopyPublish } from "./publishCopy";
import { asWorkerSees, ratingPools, type BuildInput } from "./views/board";

/**
 * The weekly re-measure of where a rating starts (README, "Where a rating starts"), as the nightly
 * runs it: on the Monday's run only, after the views are published, on the pool the boards were
 * built from, the Team Rankings pool its store holds and the League Standings seasons the publish
 * read for them (`CopyPublish.readSeason`), so it reads nothing more of the cloud. It re-measures
 * the squad year with the most games in the four weeks before the day, on its pool as the boards
 * fit it (`deriveAllKnown`, `asWorkerSees`), with the very function the Model check runs
 * (`compareClosedLevels`), and keeps the answer for the card (`closedLevelRecord.ts`). Whether the
 * level read is clearly better goes to the alarm step as a word (`closedLevelWord`), which opens an
 * issue saying a change is ready. The held level changes only by a commit.
 *
 * Measured on the owner's backup of 11 October 2026, asked the Monday after: the re-measure alone
 * took 20 s and about 1 GB above the loaded pool (2.8 GB peak) in Node 24 on four 2.1 GHz cores,
 * one fit at a time. The nightly's runner has 16 GB and its step 85 minutes, and the night peaked
 * at about 4.3 GB on the pool of 29 September. Its own scheduled workflow would have read the
 * cloud copy again; folded in, it reads nothing the publish did not.
 */

/** The day of the week it runs on, as `Date.getUTCDay` counts: Monday, the day after a week ends. */
export const CLOSED_LEVEL_WEEKDAY = 1;

const DAY = 24 * 60 * 60 * 1000;

/** Whether the nightly of members' day `today` re-measures: only on a Monday. */
export const closedLevelDue = (today: string): boolean => {
  const at = dayInstant(today);
  return Number.isFinite(at) && new Date(at).getUTCDay() === CLOSED_LEVEL_WEEKDAY;
};

/** What a weekly re-measure found, and of which squad year. */
export type WeeklyClosedLevel = { year: number | null; check: ClosedLevelCheck };

/**
 * The re-measure on the pool `input` holds, as of `input.today`: of the squad year whose pages'
 * stored games fall in the four weeks the most often, or null where none with a table has any.
 */
export const weeklyClosedLevel = (input: Omit<BuildInput, "past">): WeeklyClosedLevel | null => {
  const { ageGroups, teams, gamesOfYear, readSeason, autoRemoved, today } = input;
  const end = dayInstant(today);
  if (!Number.isFinite(end)) return null;
  const from = end - CLOSED_LEVEL_WEEKS * 7 * DAY;
  let busiest: {
    pageId: string;
    year: number | undefined;
    poolIds: string[];
    games: number;
  } | null = null;
  for (const pageIds of ratingPools(ageGroups)) {
    const pageId = pageIds.find((id) => scoutFitRanks(id, ageGroups));
    if (!pageId) continue;
    const year = ageGroupYear(ageGroups.find((group) => group.id === pageId));
    const poolIds = rankingPoolGroupIds(pageId, ageGroups);
    const onPool = new Set(poolIds);
    const games = gamesOfYear(year).filter((game) => {
      if (!onPool.has(game.ageGroupId)) return false;
      const at = dayInstant(game.date);
      return at >= from && at < end;
    }).length;
    if (games > (busiest?.games ?? 0)) busiest = { pageId, year, poolIds, games };
  }
  if (!busiest) return null;
  // The pool as the boards fit it: the year as its pages know it, after the worker's codec.
  const known = deriveAllKnown({
    ageGroups,
    teams,
    yearGames: gamesOfYear(busiest.year),
    readSeason,
    autoRemoved,
  });
  const pool = asWorkerSees(known.teams, gamesOnPages(known.games, busiest.poolIds));
  const check = compareClosedLevels(busiest.pageId, pool.teams, pool.games, ageGroups, today);
  return check && { year: busiest.year ?? null, check };
};

/** The record kept for the card, measured on members' day `today` at `at`. */
export const closedLevelRecordOf = (
  weekly: WeeklyClosedLevel,
  today: string,
  at: string
): ClosedLevelRecord => ({
  format: CLOSED_LEVEL_FORMAT,
  measuredOn: today,
  measuredAt: at,
  year: weekly.year,
  check: weekly.check,
});

/** The word for a re-measure that judged nothing (`closedLevelJudged`), which no alarm reads. */
export const CLOSED_LEVEL_UNJUDGED = "unjudged";

/**
 * The word the alarm step is handed (`nightlyVerdicts`'s `closedLevel`): `unjudged` where the
 * weeks were too thin to judge (`closedLevelJudged`), which leaves the alarm as it is, as a night
 * that did not re-measure does; `held` where a level was judged and none read clearly better,
 * which settles it; and otherwise `better`, then the level held, the level read, how much lower the
 * error was and its standard error, in runs a game, and the games, which raise it. Numbers only, as
 * everything an issue on this public repository says is.
 *
 * Before `unjudged`, a Monday too thin to judge said `held` and closed an open "a change is
 * ready" issue as no longer finding one: the seeded fixture's 17 May 2027 scores 12 games, and the
 * first Mondays of a squad year score none, since no earlier fit has rated their clubs.
 */
export const closedLevelWord = (check: ClosedLevelCheck): string =>
  !closedLevelJudged(check)
    ? CLOSED_LEVEL_UNJUDGED
    : check.better && check.level !== null && check.paired
      ? [
          "better",
          String(check.held),
          check.level.toFixed(2),
          check.paired.by.toFixed(5),
          check.paired.standardError.toFixed(5),
          String(check.paired.samples),
        ].join(" ")
      : "held";

/** A level, or a reading, to `digits` places, or a dash for none. */
const fixed = (value: number | null, digits: number): string =>
  value === null ? "-" : value.toFixed(digits);

/**
 * What the nightly's log says of the re-measure: counts and numbers only, since the log is public.
 * Not a club, a league or a name in it.
 */
export const describeWeekly = (weekly: WeeklyClosedLevel | null, seconds: number): string[] => {
  if (!weekly) {
    return [
      "The starting level was not re-measured: no squad year with a table has games in the four weeks.",
    ];
  }
  const { check } = weekly;
  const first = check.weeks[0];
  const last = check.weeks[check.weeks.length - 1];
  const span = first && last ? `${first.from} to ${last.to}` : "the four weeks";
  const lines = [
    `Starting level re-measured on the ${weekly.year ?? "undated"} squad year, ${span}: ${fixed(check.level, 2)} +/- ${fixed(check.standardError, 2)} on ${check.games} games in ${check.clusters} clusters (weeks of ${check.weeks.map((week) => week.games).join(", ")}), in ${seconds} s.`,
  ];
  const paired = check.paired;
  const verdict = !closedLevelJudged(check)
    ? "too few games to judge, so nothing is settled"
    : check.better
      ? "clearly better, so a change is ready"
      : "not clearly better, so the level held stands";
  lines.push(
    paired
      ? `  Each week scored with the level the other weeks read: ${Math.abs(paired.by).toFixed(5)} +/- ${paired.standardError.toFixed(5)} runs a game ${paired.by >= 0 ? "better" : "worse"} than the ${check.held} held, over ${paired.samples} games; ${verdict}.`
      : "  No week could be scored with the other weeks' level, so nothing was judged and nothing is settled."
  );
  return lines;
};

/** What the nightly hands the re-measure once it has published the views (`remeasureAfterPublish`). */
export type NightlyRemeasure = {
  /** The publish just before it, or null where none ran or it threw. */
  views: CopyPublish | null;
  /** The members' day it re-measures as of: four weeks to the Sunday before it. */
  today: string;
  /** A live run keeps the answer and hands the alarm its word; a dry run only says it. */
  live: boolean;
  /** The pool its store holds, which the publish built the boards from, League aside. */
  pool: () => Omit<BuildInput, "past" | "readSeason" | "today">;
  /** Keeps the record for the card (`ServerStores.writeClosedLevel`). */
  keep: (record: ClosedLevelRecord) => Promise<void>;
  /** Hands the alarm step its word (`closedLevelWord`). */
  handWord: (word: string) => void;
  log: (line: string) => void;
  /** The time, as an ISO string, the record is stamped with. */
  now: () => string;
  /** Milliseconds, for how long it took. */
  clock?: () => number;
};

/**
 * The nightly's re-measure, run once the views are out: on the boards' own pool, League as the
 * publish read it, never read again, so a score a member saves after the publish's last look
 * reaches neither. Where the views were not published (refused, as when League moved during the
 * publish, or stopped), it does not re-measure: the pool would not be the one any board was built
 * from. Never the night's failure: one that stops says so and leaves the alarm as it is. What it
 * found, or null where it did not re-measure.
 */
export const remeasureAfterPublish = async ({
  views,
  today,
  live,
  pool,
  keep,
  handWord,
  log,
  now,
  clock = Date.now,
}: NightlyRemeasure): Promise<WeeklyClosedLevel | null> => {
  if (!views?.ok) {
    log(
      "The views were not published, so the starting level was not re-measured on a pool no board was built from."
    );
    return null;
  }
  try {
    const startedAt = clock();
    const weekly = weeklyClosedLevel({ ...pool(), readSeason: views.readSeason, today });
    for (const line of describeWeekly(weekly, Math.round((clock() - startedAt) / 1000))) {
      log(line);
    }
    if (!weekly || !live) return weekly;
    // The alarm's word first: a record that will not save still leaves the owner told.
    handWord(closedLevelWord(weekly.check));
    await keep(closedLevelRecordOf(weekly, today, now()));
    log("  Kept for the Model check card.");
    return weekly;
  } catch (error) {
    log(`The starting level's re-measure stopped: ${failureWords(error)}`);
    return null;
  }
};
