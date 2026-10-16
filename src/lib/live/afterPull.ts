import { REFRESH_GATE_PATH } from "../cloud/refreshGate";
import { catchUpDecision, stillBehind, type Behind, type CatchUp } from "./catchUp";
import { readCloudLeague } from "./cloudLeague";
import type { CopyPublish } from "./publishCopy";
import { reserveRebuildJob } from "./rebuildJobBudget";
import { coerceLedger } from "./rebuildLedger";
import { republishViews, type Republish } from "./republish";
import type { ServerStores } from "./serverStores";

/**
 * The boards published when a pull ends (README, "Boards published when a pull ends"): a pasted
 * list's import, each part of one sent in parts, and "Refresh now" alike. Each ends by saving the
 * copy, and that save asks for a rebuild after it (`onCopyWrite`), which publishes the boards. But
 * the rebuilds stop for the rest of a month whose budget is spent (from 14 October 2026 until
 * November, with 125,954 teams of 2027 imported and nothing on the site), and the catch-up on
 * GitHub that stood in for them (`catchUp.ts`) runs only when GitHub's schedule starts it, which on
 * 16 October was not once in the three and a half hours after it was merged (seven times due), the
 * nightly's own start being four and a half hours late.
 *
 * So where a pull ends and no rebuild is coming to publish what it saved, the cloud publishes it
 * at once itself: the end of the pull asks (`launchAfterPull`), and where the boards are behind
 * and nothing else is at work on them, starts the `boards-publish` job, which asks again and
 * publishes as the catch-up does (`publishAfterPull`). Its cost is the import's: the 17:40 catch-up
 * on 16 October built the year's 66 boards in 31 s and put them up in 86 s in all, against the
 * hours an import of a list takes.
 */

/**
 * Whether a rebuild after a save is coming to publish the boards: switched on to publish (not off,
 * nor a dry run that publishes nothing), and either a run is open on the ledger, its budget
 * reserved, or the ledger would let one start (`reserveRebuildJob`). A month or a day whose cap is
 * spent, or failures that paused them for the day, would only defer it. Holding the rebuild job's
 * control counts for nothing by itself: a job claims it before it reserves, and one whose budget
 * is spent defers the moment it asks, publishing nothing (Codex, on #408). `ledger` is the
 * document as stored (`ops/rebuild`), `today` New York's day, as the ledger counts days.
 */
export const rebuildWillPublish = (ledger: unknown, today: string, now: Date): boolean => {
  const read = coerceLedger(ledger);
  if (!read?.on || read.mode !== "live") return false;
  const reserved = reserveRebuildJob(read, today, now.toISOString(), "");
  return reserved.ok || reserved.why === "busy";
};

/** Whether the boards are published now, after a pull: the catch-up's answer, or a rebuild's to. */
export type AfterPull =
  | CatchUp
  /** Behind, but a rebuild after the pull's save is coming to publish them (`rebuildWillPublish`). */
  | { publish: false; because: "rebuild-coming"; behind: Behind };

/** What a publish after a pull reads of the cloud, and writes: only the views (`"live"` stores). */
export type AfterPullStores = Pick<
  ServerStores,
  "copy" | "live" | "leagueDocs" | "gate" | "readCopyAt" | "pullsUnderWay" | "readLedger"
>;

/**
 * Whether to publish the boards now that a pull has ended, on New York's day `today` (`budgetDay`):
 * the catch-up's decision (`catchUpDecision`), without its ten minutes' wait for the copy to be
 * still, since the save it would wait out is the pull's own last; and then not where a rebuild is
 * coming to publish them, which is the boards' way after any save while the rebuilds' budget lasts.
 * The nightly is not asked after on GitHub, which nothing in the cloud can ask; one pulling holds
 * the refresh gate, and is waited on there. Nor is the rebuild job's control, which the catch-up
 * waits on: whether a rebuild is coming is the ledger's to say (`rebuildWillPublish`), and only
 * where the build deployed the rebuilds at all (`rebuilds`, the functions' LIVE_REBUILD). A build
 * without them takes their trigger down, and a ledger left on from before would wait for ever on
 * a rebuild nothing asks for (Codex, on #408).
 */
export const afterPullDecision = async (
  stores: Omit<AfterPullStores, "copy">,
  today: string,
  now: Date,
  rebuilds: boolean
): Promise<AfterPull> => {
  const [copy, read, league] = await Promise.all([
    stores.readCopyAt(),
    stores.live.readMeta(),
    readCloudLeague(stores.leagueDocs),
  ]);
  const rebuild: { ledger?: unknown } = {};
  const decided = await catchUpDecision({
    copy,
    meta: read?.meta ?? null,
    league,
    today,
    now,
    settleMs: 0,
    writers: async () => {
      const [gate, jobs, ledger] = await Promise.all([
        stores.gate.readAt(REFRESH_GATE_PATH),
        stores.pullsUnderWay(),
        stores.readLedger(),
      ]);
      rebuild.ledger = ledger;
      return { nightlyRuns: null, gate: gate?.fields ?? null, jobs, rebuildJob: null };
    },
  });
  if (!decided.publish) return decided;
  return rebuilds && rebuildWillPublish(rebuild.ledger, today, now)
    ? { publish: false, because: "rebuild-coming", behind: decided.behind }
    : decided;
};

/**
 * The end of a pull: where the boards want publishing now (`afterPullDecision`), `launch` starts
 * the job that publishes them. What it decided is handed back for the log.
 */
export const launchAfterPull = async (
  stores: Omit<AfterPullStores, "copy">,
  launch: () => Promise<void>,
  today: string,
  now: Date,
  rebuilds: boolean
): Promise<AfterPull> => {
  const decided = await afterPullDecision(stores, today, now, rebuilds);
  if (decided.publish) await launch();
  return decided;
};

/**
 * The least time the ask at a pull's end needs before its caller's deadline: a few reads, and the
 * launch, whose request waits up to 25 s (`launchBoardsPublish`).
 */
export const AFTER_PULL_ASK_MS = 30_000;

/**
 * `ask`, where there is time for it before `deadline` (milliseconds since the epoch), and raced
 * against that deadline, so a slow one never holds its caller past it; null where there is not, or
 * it ran out. A leg of "Refresh now" may end with seconds of its task's half hour left, and the
 * task cut off there would read as a leg that timed out, and run again: one so late leaves the
 * boards to the catch-up and the nightly. The import job has no deadline (`Infinity`).
 */
export const askInTime = async <T>(
  ask: () => Promise<T>,
  deadline: number,
  now = Date.now()
): Promise<T | null> => {
  const left = deadline - now;
  if (!(left >= AFTER_PULL_ASK_MS)) return null;
  if (left === Number.POSITIVE_INFINITY) return ask();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ask(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), left);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** What the publish after a pull decided, and how its publish ended where it published. */
export type AfterPullRun = { decided: AfterPull; result?: Republish };

/**
 * The `boards-publish` job's run: asked again, since the job starts a minute or so after the pull
 * ended and a rebuild or another pull's publish may have put the boards out meanwhile, and where
 * they still want it, published as the catch-up publishes them (`republishViews`): the copy loaded,
 * the boards built and published under the copy and version read, and tried again on the copy as it
 * then stands where a save moved it meanwhile, for as long as they are still behind it.
 */
export const publishAfterPull = async (
  stores: AfterPullStores,
  deps: {
    today: () => string;
    now: () => Date;
    /** Whether the build deployed the rebuilds after saves (`afterPullDecision`). */
    rebuilds: boolean;
    /** The collation the boards are built under: the server's own (`boardLocale`) unless a test says. */
    locale?: string;
    onViews?: (views: CopyPublish) => void;
  }
): Promise<AfterPullRun> => {
  const decided = await afterPullDecision(stores, deps.today(), deps.now(), deps.rebuilds);
  if (!decided.publish) return { decided };
  const result = await republishViews({
    copyStore: stores.copy,
    liveStore: stores.live,
    leagueDocs: stores.leagueDocs,
    today: deps.today,
    now: () => deps.now().toISOString(),
    // As a rebuild after a save sweeps: only what its own commit retires past its grace.
    sweep: "due",
    wanted: async (published) =>
      stillBehind({
        meta: published,
        manifest: await stores.copy.readManifest(),
        league: await readCloudLeague(stores.leagueDocs),
        today: deps.today(),
      }),
    ...(deps.locale !== undefined ? { locale: deps.locale } : {}),
    ...(deps.onViews ? { onViews: deps.onViews } : {}),
  });
  return { decided, result };
};
