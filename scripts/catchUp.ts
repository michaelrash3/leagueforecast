/**
 * The boards caught up with the cloud copy between nights (README, "Boards caught up on GitHub"),
 * run by the catch-up workflow every half hour. It reads the copy's manifest, the published meta
 * and the League Standings seasons, and where the boards are behind the copy (`catchUpDecision`)
 * and nothing is at work that a publish now would run beside (the nightly, a pull or an import
 * writing the copy, a rebuild after a save, a save under ten minutes old), it publishes them as the
 * republish after a deploy does (`republishViews`): the copy laid into memory as a pull lays it,
 * the boards built and published under the copy and version read, and tried again on the copy as it
 * then stands when a save moved it meanwhile. Otherwise it says why in a line and is done, in the
 * time it takes to read those few documents.
 *
 * It is for the time a save's own rebuild does not come: rebuilds switched off, paused, deferred to
 * a later month by their budget, or failing. It opens the copy as the republish does, on the same
 * Firebase key, with only `live/` writable (`openStores`): it pulls nothing from GameChanger,
 * tidies nothing and saves nothing of the copy. It prints counts, sizes and timings only: this
 * repository is public, and so are its Actions logs.
 *
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" npm run catch-up
 *
 * `NIGHTLY_RUNS` is how many of the nightly refresh's runs GitHub has not yet completed, as the
 * workflow asked it just before; left unset, the nightly is not waited on. Run under the nightly's
 * time zone and collation (`TZ=America/New_York`, `LANG=en_US.UTF-8`) and with its heap, as the
 * republish is, since a publish holds the whole pool.
 */
import { failureWords } from "../src/lib/cloud/firestoreRest.ts";
import { REFRESH_GATE_PATH } from "../src/lib/cloud/refreshGate.ts";
import { todayIsoDay } from "../src/lib/date.ts";
import {
  CATCH_UP_SETTLE_MS,
  catchUpDecision,
  stillBehind,
  type Behind,
  type LeftBecause,
} from "../src/lib/live/catchUp.ts";
import { readCloudLeague } from "../src/lib/live/cloudLeague.ts";
import { publishFailedRun, type CopyPublish } from "../src/lib/live/publishCopy.ts";
import { republishViews, REPUBLISH_TRIES } from "../src/lib/live/republish.ts";
import { resetTeamRankingsStore } from "../src/lib/teamRankingsStorage.ts";
import { openStores } from "./cloudPool.ts";
import { mb, tellViews } from "./viewsReport.ts";

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
  exit: (code?: number) => never;
  memoryUsage: () => { rss: number };
};

const started = Date.now();
const since = (): string => `${Math.round((Date.now() - started) / 1000)} s`;

/** Why the boards are behind the copy, for the log. */
const BEHIND: Record<Behind, string> = {
  nothing: "nothing is published",
  "older-build": "the published views are an older build's",
  "no-record": "nothing says what the published boards were built from",
  "other-copy": "the published boards are another copy's",
  league: "a League Standings season changed since the boards were published",
  inputs: "what the boards read of the copy changed since they were published",
};

/** Why nothing is published, for the log. */
const LEFT: Record<LeftBecause, string> = {
  "no-copy": "There is no cloud copy, so there are no boards to publish.",
  "unreadable-copy": "The copy's manifest is not one this build reads, so nothing was published.",
  "newer-copy": "A newer build saved the copy, so its boards are that build's to publish.",
  "league-unreadable": "A League Standings season could not be read, so nothing was published.",
  "newer-league":
    "A League Standings season was saved by a newer build, so the boards are that build's to publish.",
  "unreadable-views": "The published meta is not one this build reads, so nothing was published.",
  "newer-views":
    "The published boards were made by a newer build or newer rules, so they are left as they are.",
  "later-day": "The published views are already a later day's, so they are left as they are.",
  current: "The boards are current with the copy.",
  "nightly-running": "the nightly refresh is running on GitHub, and publishes them itself",
  "nightly-pulling":
    "the nightly is pulling at the refresh gate, and publishes them when it is done",
  pulling: "a pull or an import is writing the copy; a run after it is done publishes them",
  rebuilding: "a rebuild after a save is running in the cloud, and publishes them itself",
  settling: `the copy was saved less than ${CATCH_UP_SETTLE_MS / 60_000} minutes ago; a rebuild may yet publish them, or a run once it has been still that long`,
};

/** The nightly's runs GitHub has not completed, as the workflow handed them over, or null. */
const nightlyRunsOf = (said: string | undefined): number | null => {
  const runs = Number(said);
  return said !== undefined && said.trim() !== "" && Number.isSafeInteger(runs) && runs >= 0
    ? runs
    : null;
};

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const main = async (): Promise<void> => {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!key) {
    console.log("No FIREBASE_SERVICE_ACCOUNT here, so there are no boards to catch up.");
    process.exitCode = 1;
    return;
  }
  const opened = openStores(key, "live");
  const today = todayIsoDay();
  const [copy, read, league] = await Promise.all([
    opened.readCopyAt(),
    opened.live.readMeta(),
    readCloudLeague(opened.leagueDocs),
  ]);
  const decided = await catchUpDecision({
    copy,
    meta: read?.meta ?? null,
    league,
    today,
    now: new Date(),
    writers: async () => ({
      nightlyRuns: nightlyRunsOf(process.env.NIGHTLY_RUNS),
      gate: (await opened.gate.readAt(REFRESH_GATE_PATH))?.fields ?? null,
      jobs: await opened.pullsUnderWay(),
      rebuildJob: await opened.readRebuildJob(),
    }),
  });
  if (!decided.publish) {
    console.log(
      decided.behind === undefined
        ? LEFT[decided.because]
        : `${capitalized(BEHIND[decided.behind])}, but ${LEFT[decided.because]}.`
    );
    return;
  }
  console.log(
    `${capitalized(BEHIND[decided.behind])}: publishing the boards (read in ${since()}).`
  );
  let last: CopyPublish | null = null;
  const result = await republishViews({
    copyStore: opened.copy,
    liveStore: opened.live,
    leagueDocs: opened.leagueDocs,
    today: todayIsoDay,
    now: () => new Date().toISOString(),
    // As a rebuild after a save sweeps: only what its own commit retires past its grace; the
    // night's full sweep finds the rest.
    sweep: "due",
    wanted: async (published) =>
      stillBehind({
        meta: published,
        manifest: await opened.copy.readManifest(),
        league: await readCloudLeague(opened.leagueDocs),
        today: todayIsoDay(),
      }),
    onLoaded: (loaded, _published, attempt) =>
      console.log(
        `${attempt > 1 ? `Try ${attempt} of ${REPUBLISH_TRIES}: read` : "Read"} the copy at version ${loaded.manifest.version} (${loaded.keys} parts, ${mb(loaded.bytes)} gzipped) in ${since()}.`
      ),
    onViews: (views) => {
      last = views;
      tellViews(views, false);
    },
  });
  const said: Record<typeof result.end, string> = {
    "not-needed": "The boards were published by something else before this run began to.",
    "no-copy": "There is no cloud copy, so there are no boards to publish.",
    "newer-copy":
      "The copy was saved or tidied by a newer build than this one, so its boards are that build's to publish.",
    published: `Published in ${result.tries} ${result.tries === 1 ? "try" : "tries"}.`,
    "published-since":
      "Not published by this run, but the boards are no longer behind the copy: something else published them.",
    refused: `Not published after ${result.tries} ${result.tries === 1 ? "try" : "tries"}.`,
  };
  console.log(said[result.end]);
  // As the nightly judges its own publish (`publishFailedRun`): a copy or a season saved during the
  // run, or views a newer build published first, are no fault of the run's, and the next run
  // publishes; anything else that stopped it is.
  const lastViews = last as CopyPublish | null;
  if (result.end === "refused" && lastViews !== null && publishFailedRun(lastViews)) {
    process.exitCode = 1;
  } else if (result.end === "refused") {
    console.log("  That is no fault of this run's: the next run publishes them.");
  }
};

try {
  await main();
} catch (error) {
  // The message and the network's code only: nothing here quotes the key.
  console.log(`The catch-up stopped: ${failureWords(error)}`);
  process.exitCode = 1;
} finally {
  // The store opens a channel to other tabs that would keep the process alive.
  resetTeamRankingsStore();
}
console.log(`Done in ${since()}; memory at the end ${mb(process.memoryUsage().rss)}.`);
process.exit(process.exitCode ?? 0);
