/*
 * The pace of a GameChanger pull: how often it saves, how long it is expected to take, the clock
 * its tracker reads, and the session it starts under. They sat at the top of
 * GameChangerImportPanel.tsx; the run itself now lives in `useGcPullRun`, and the panel's words
 * about it (how often it saves, about how many minutes) read the same numbers from here.
 */
import { BATCH_SIZE, PULL_CONCURRENCY } from "./gameChangerClient";
import { beginPull } from "./pullSession";
import { createPullTracker, type PullRunLog, type PullTracker } from "./pullTracker";
import { savePullLog } from "./teamRankingsStorage";

/**
 * Writes the run's record beside the pool. Written asynchronously — the record is read on demand,
 * not from the pool's cache — and a refusal, or a store that throws, is noted in the record itself
 * rather than allowed anywhere near the run.
 */
export const persistLog = (tracker: PullTracker, log: PullRunLog): void => {
  savePullLog(log).then(
    (ok) => {
      if (!ok) tracker.unpersisted();
    },
    () => tracker.unpersisted()
  );
};

/**
 * How many teams to fetch between saves, given how big the pool already is.
 *
 * Every save writes the *whole* pool — the store keeps it as one value, so there is no such thing
 * as appending a game to it. That is fine at a few thousand teams and ruinous at a hundred
 * thousand: a fixed interval means the number of saves grows with the run while the cost of each
 * one grows with the pool, so the total written grows as the square. Measured on a real pool at 169
 * bytes a row encoded, a nationwide pull saving every five hundred teams writes **fourteen to
 * twenty-six gigabytes to disk** to store a few hundred megabytes, and allocates the encoded pool
 * as garbage each time. It is the reason such a pull slows to a crawl and buries the tab in
 * collection: not the fetching, the saving.
 *
 * So the interval grows with the pool. Twenty-odd saves instead of two hundred and thirty on a
 * nationwide pull, a tenth of the disk and a tenth of the garbage. And it never drops below two
 * thousand teams, because a save costs the whole pool however few teams came with it: a pull of
 * five thousand into a small pool saves twice rather than ten times. What it costs is how much a
 * stop or a crash can undo — two thousand teams at the least, about a minute of fetching, and at
 * the ceiling five thousand, two or three minutes.
 */
export const SAVE_EVERY_MIN = 2000;
export const SAVE_EVERY_MAX = 5000;
export const saveEvery = (games: number): number => {
  /*
   * Guarded rather than trusted, because of what the arithmetic does with a number that is not
   * one: `Math.max(2000, NaN)` is NaN, and the caller's test is `unsaved.length >= interval`, which
   * is false for NaN every time — so a bad count here would not make the pull save badly, it would
   * make it never save at all, and lose the lot on the way out.
   */
  if (!Number.isFinite(games) || games <= 0) return SAVE_EVERY_MIN;
  return Math.min(SAVE_EVERY_MAX, Math.max(SAVE_EVERY_MIN, Math.round(games / 100)));
};

/**
 * Seconds one batch request takes, end to end.
 *
 * A round assumption rather than a measurement, and labelled as one. A batch is ten teams, whose
 * twenty upstream fetches all start in the same tick, so the request costs about what the slowest
 * of them does — a live check of a single team through the proxy came back in roughly 300ms, and a
 * second is a fair allowance for ten of them plus the round trip.
 */
export const SECONDS_PER_BATCH = 1;

/**
 * Roughly how long a run of `fresh` teams will spend making requests.
 *
 * Teams are asked for ten at a time, so the work is `fresh / BATCH_SIZE` requests shared between
 * the workers — not one request per team, and not two. Leaving out the batch size read every team
 * as its own pair of requests and overstated a 52,470-team run by a factor of ten: 219 minutes
 * against a floor nearer 11.
 */
export const estimatedMinutes = (fresh: number): number => {
  const requests = Math.ceil(fresh / BATCH_SIZE);
  const seconds = (requests / PULL_CONCURRENCY) * SECONDS_PER_BATCH;
  return Math.max(1, Math.ceil(seconds / 60));
};

export const nowIso = () => new Date().toISOString();

/** Claims the pool for a pull starting now, with the tracker that records it (`beginPull`). */
export const newPullSession = () => {
  const startedAt = nowIso();
  return beginPull(startedAt, createPullTracker(startedAt));
};

/**
 * The clock, behind a function.
 *
 * Every timing the tracker keeps is a difference between two of these. Read through a helper
 * rather than called in place because the compiler cannot tell a call made while a run is going
 * from one made during a render, and reads the second as a component that will not settle.
 */
export const msNow = () => Date.now();
